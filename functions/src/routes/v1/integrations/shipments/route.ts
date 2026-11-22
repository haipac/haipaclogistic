import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { randomInt, randomUUID } from "node:crypto";
import { z } from "zod";
import { ApiError } from "@/lib/firebase/auth";
import { getFirebaseAdminDb } from "@/lib/firebase/admin";
import { apiFailure, jsonOk } from "@/lib/api/http";
import { getActiveCommune } from "@/lib/logistics/coverage";
import { queueEmail } from "@/lib/email/outbox";
import { createOpaqueToken, sha256 } from "@/lib/security/secrets";
import { getIdempotencyKey, verifySmartCutRequest } from "@/lib/integrations/smartcut-signature";
import { requireProductionReadiness } from "@/lib/api/production-readiness";


const ShipmentRequestSchema = z.object({
  paymentStatus: z.literal("paid"),
  paymentVerifiedAt: z.string().datetime({ offset: true }),
  paymentReference: z.string().trim().min(1).max(120),
  quoteId: z.string().uuid(),
  checkoutRef: z.string().trim().min(16).max(100),
  smartCutOrderId: z.string().trim().min(1).max(100),
  recipientName: z.string().trim().min(2).max(100),
  recipientEmail: z.string().trim().email().max(254),
  recipientPhone: z.string().trim().min(7).max(32),
  destinationCommuneCode: z.string().trim().toUpperCase().regex(/^[A-Z0-9_-]{2,40}$/),
  locality: z.string().trim().min(2).max(120),
  addressLine: z.string().trim().min(4).max(240),
  directions: z.string().trim().max(500).optional().default(""),
}).strict();

function generateTrackingNumber() {
  return `HPL${String(randomInt(0, 10_000_000_000)).padStart(10, "0")}`;
}

export async function POST(request: Request) {
  try {
    await requireProductionReadiness();
    if (!request.headers.get("content-type")?.toLowerCase().includes("application/json")) throw new ApiError(415, "JSON_REQUIRED");
    const rawBody = await request.text();
    if (new TextEncoder().encode(rawBody).byteLength > 64 * 1024) throw new ApiError(413, "REQUEST_TOO_LARGE");
    await verifySmartCutRequest(request, rawBody);
    const idempotencyKey = getIdempotencyKey(request);
    let body: unknown;
    try { body = JSON.parse(rawBody) as unknown; } catch { throw new ApiError(400, "INVALID_JSON"); }
    const parsed = ShipmentRequestSchema.safeParse(body);
    if (!parsed.success) throw new ApiError(400, "SHIPMENT_REQUEST_INVALID");
    const input = parsed.data;
    const paymentVerifiedAt = new Date(input.paymentVerifiedAt);
    if (paymentVerifiedAt.getTime() > Date.now() + 60_000) throw new ApiError(400, "PAYMENT_TIME_INVALID");
    const destination = await getActiveCommune(input.destinationCommuneCode);
    const db = getFirebaseAdminDb();
    const idempotencyRef = db.collection("integrationIdempotency").doc(`shipment_${sha256(idempotencyKey)}`);
    const prior = await idempotencyRef.get();
    if (prior.exists) {
      if (prior.get("smartCutOrderId") !== input.smartCutOrderId || prior.get("quoteId") !== input.quoteId || prior.get("checkoutRef") !== input.checkoutRef) throw new ApiError(409, "IDEMPOTENCY_KEY_REUSED");
      const shipments = prior.get("shipments") as Array<{ packageRef: string; trackingNumber: string; status: string }> | undefined;
      const trackingNumbers = prior.get("trackingNumbers") as string[] | undefined;
      return jsonOk({
        smartCutOrderId: input.smartCutOrderId,
        shipments: shipments ?? (trackingNumbers ?? []).map((trackingNumber) => ({ packageRef: "", trackingNumber, status: "registered" })),
      });
    }

    const quoteRef = db.collection("quotes").doc(input.quoteId);
    const quoteSnapshot = await quoteRef.get();
    if (!quoteSnapshot.exists) throw new ApiError(404, "QUOTE_NOT_FOUND");
    const quote = quoteSnapshot.data()!;
    const quoteCreatedAt = quote.createdAt?.toDate?.().getTime?.() ?? 0;
    if (quote.checkoutRef !== input.checkoutRef || quote.destinationCommuneCode !== destination.code || quote.status !== "payment_pending" || quote.smartCutOrderId !== input.smartCutOrderId) {
      throw new ApiError(409, "QUOTE_MISMATCH");
    }
    if (paymentVerifiedAt.getTime() < quoteCreatedAt) throw new ApiError(409, "PAYMENT_TIME_INVALID");
    const paymentExpiresAt = quote.paymentExpiresAt?.toDate?.().getTime?.() ?? 0;
    if (!paymentExpiresAt || paymentVerifiedAt.getTime() > paymentExpiresAt) throw new ApiError(409, "PAYMENT_RESERVATION_EXPIRED");
    const parcelQuotes = quote.parcels as Array<Record<string, unknown>>;
    if (!Array.isArray(parcelQuotes) || parcelQuotes.length < 1 || parcelQuotes.length > 50) throw new ApiError(503, "QUOTE_DATA_INVALID");

    const rows = parcelQuotes.map((parcel) => {
      const trackingNumber = generateTrackingNumber();
      const shipmentId = randomUUID();
      const claimToken = createOpaqueToken();
      return {
        shipmentId,
        trackingNumber,
        shipmentRef: db.collection("shipments").doc(shipmentId),
        trackingRef: db.collection("tracking").doc(trackingNumber),
        claimRef: db.collection("claimTokens").doc(sha256(claimToken)),
        claimToken,
        parcel,
      };
    });
    const duplicateTracking = new Set(rows.map((row) => row.trackingNumber)).size !== rows.length;
    if (duplicateTracking) throw new ApiError(503, "TRACKING_ID_GENERATION_FAILED");

    const appUrl = process.env.HAIPAC_PUBLIC_URL;
    if (!appUrl || !/^https:\/\//.test(appUrl)) throw new ApiError(503, "PUBLIC_APP_URL_NOT_CONFIGURED");
    const claimExpiresAt = Timestamp.fromMillis(Date.now() + 14 * 24 * 60 * 60 * 1000);
    const summaries = rows.map((row) => ({ packageRef: String(row.parcel.packageRef), trackingNumber: row.trackingNumber, status: "registered" }));

    await db.runTransaction(async (transaction) => {
      const [existingIdempotency, latestQuote, ...trackingSnapshots] = await Promise.all([
        transaction.get(idempotencyRef),
        transaction.get(quoteRef),
        ...rows.map((row) => transaction.get(row.trackingRef)),
      ]);
      if (existingIdempotency.exists) throw new ApiError(409, "SHIPMENT_REQUEST_IN_PROGRESS");
      if (!latestQuote.exists || latestQuote.get("status") !== "payment_pending" || latestQuote.get("smartCutOrderId") !== input.smartCutOrderId) throw new ApiError(409, "QUOTE_ALREADY_USED");
      if (trackingSnapshots.some((snapshot) => snapshot.exists)) throw new ApiError(503, "TRACKING_ID_COLLISION");

      rows.forEach((row) => {
        const parcel = row.parcel;
        transaction.create(row.shipmentRef, {
          trackingNumber: row.trackingNumber,
          smartCutOrderId: input.smartCutOrderId,
          checkoutRef: input.checkoutRef,
          quoteId: input.quoteId,
          quoteRateVersion: quote.rateVersion,
          zoneId: quote.zoneId,
          amountHtg: parcel.amountHtg,
          currency: "HTG",
          parcel: {
            packageRef: parcel.packageRef,
            weight: parcel.weight,
          },
          destinationCommuneCode: destination.code,
          destinationName: destination.name,
          destinationDepartmentCode: destination.departmentCode,
          locality: input.locality,
          addressLine: input.addressLine,
          directions: input.directions,
          recipientName: input.recipientName,
          recipientEmail: input.recipientEmail.trim().toLowerCase(),
          recipientPhone: input.recipientPhone,
          recipientUid: null,
          paymentReference: input.paymentReference,
          paymentVerifiedAt: Timestamp.fromDate(paymentVerifiedAt),
          status: "registered",
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        });
        transaction.create(row.trackingRef, {
          shipmentId: row.shipmentId,
          status: "registered",
          updatedAt: FieldValue.serverTimestamp(),
        });
        transaction.create(row.claimRef, {
          shipmentId: row.shipmentId,
          recipientEmail: input.recipientEmail.trim().toLowerCase(),
          createdAt: FieldValue.serverTimestamp(),
          expiresAt: claimExpiresAt,
        });
        const claimUrl = `${appUrl.replace(/\/$/, "")}/revendiquer?token=${encodeURIComponent(row.claimToken)}`;
        queueEmail(transaction, db, {
          template: "claim_shipment",
          to: input.recipientEmail,
          subject: `Votre colis HAIPAC ${row.trackingNumber}`,
          data: { claimUrl, trackingNumber: row.trackingNumber, recipientName: input.recipientName },
        });
      });
      transaction.update(quoteRef, { status: "used", shipmentIds: rows.map((row) => row.shipmentId), usedAt: FieldValue.serverTimestamp() });
      transaction.create(idempotencyRef, {
        smartCutOrderId: input.smartCutOrderId,
        quoteId: input.quoteId,
        checkoutRef: input.checkoutRef,
        trackingNumbers: rows.map((row) => row.trackingNumber),
        shipmentIds: rows.map((row) => row.shipmentId),
        shipments: summaries,
        createdAt: FieldValue.serverTimestamp(),
      });
    });

    return jsonOk({ smartCutOrderId: input.smartCutOrderId, shipments: summaries }, 201);
  } catch (error) {
    return apiFailure(error);
  }
}
