import { FieldValue, Timestamp, type DocumentData } from "firebase-admin/firestore";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { ApiError } from "@/lib/firebase/auth";
import { apiFailure, jsonOk } from "@/lib/api/http";
import { getFirebaseAdminDb } from "@/lib/firebase/admin";
import { getActiveCommune, zoneBetween } from "@/lib/logistics/coverage";
import { quoteParcels, type RateCard } from "@/lib/logistics/rates";
import { sha256 } from "@/lib/security/secrets";
import { getIdempotencyKey, verifySmartCutRequest } from "@/lib/integrations/smartcut-signature";
import { requireProductionReadiness } from "@/lib/api/production-readiness";


const QuoteRequestSchema = z.object({
  checkoutRef: z.string().trim().min(16).max(100),
  destinationCommuneCode: z.string().trim().toUpperCase().regex(/^[A-Z0-9_-]{2,40}$/),
  parcels: z.array(z.object({
    packageRef: z.string().trim().min(1).max(64),
    lengthCm: z.number().finite().positive().max(500),
    widthCm: z.number().finite().positive().max(500),
    heightCm: z.number().finite().positive().max(500),
    realWeightKg: z.number().finite().positive().max(1000),
  }).strict()).min(1).max(50),
}).strict().superRefine((value, context) => {
  const refs = value.parcels.map((parcel) => parcel.packageRef);
  if (new Set(refs).size !== refs.length) {
    context.addIssue({ code: "custom", path: ["parcels"], message: "PACKAGE_REFS_MUST_BE_UNIQUE" });
  }
});

function quoteDto(data: DocumentData) {
  return {
    quoteId: data.quoteId,
    checkoutRef: data.checkoutRef,
    amountHtg: data.amountHtg,
    currency: "HTG",
    rateVersion: data.rateVersion,
    zoneId: data.zoneId,
    destinationCommuneCode: data.destinationCommuneCode,
    expiresAt: data.expiresAt?.toDate?.().toISOString?.() ?? null,
    parcels: data.parcels,
  };
}

export async function POST(request: Request) {
  try {
    await requireProductionReadiness();
    if (!request.headers.get("content-type")?.toLowerCase().includes("application/json")) throw new ApiError(415, "JSON_REQUIRED");
    const rawBody = await request.text();
    if (new TextEncoder().encode(rawBody).byteLength > 64 * 1024) throw new ApiError(413, "REQUEST_TOO_LARGE");
    const { bodyHash } = await verifySmartCutRequest(request, rawBody);
    const idempotencyKey = getIdempotencyKey(request);
    let input: unknown;
    try { input = JSON.parse(rawBody) as unknown; } catch { throw new ApiError(400, "INVALID_JSON"); }
    const parsed = QuoteRequestSchema.safeParse(input);
    if (!parsed.success) throw new ApiError(400, "QUOTE_REQUEST_INVALID");
    const value = parsed.data;
    const db = getFirebaseAdminDb();

    const idempotencyRef = db.collection("integrationIdempotency").doc(`quote_${sha256(idempotencyKey)}`);
    const prior = await idempotencyRef.get();
    if (prior.exists) {
      if (prior.get("requestHash") !== bodyHash) throw new ApiError(409, "IDEMPOTENCY_KEY_REUSED");
      const quoteSnapshot = await db.collection("quotes").doc(String(prior.get("quoteId"))).get();
      if (!quoteSnapshot.exists || quoteSnapshot.get("status") !== "open") throw new ApiError(409, "QUOTE_NO_LONGER_AVAILABLE");
      if ((quoteSnapshot.get("expiresAt")?.toMillis?.() ?? 0) <= Date.now()) throw new ApiError(409, "QUOTE_EXPIRED");
      return jsonOk(quoteDto(quoteSnapshot.data()!));
    }

    const settingsSnapshot = await Promise.all([
      db.collection("settings").doc("dispatch").get(),
      db.collection("settings").doc("rates").get(),
    ]);
    const dispatchSettings = settingsSnapshot[0].data();
    const rateSettings = settingsSnapshot[1].data();
    if (typeof dispatchSettings?.originCommuneCode !== "string") throw new ApiError(503, "DISPATCH_ORIGIN_NOT_CONFIGURED");
    if (typeof rateSettings?.activeVersion !== "string") throw new ApiError(503, "RATE_CARD_NOT_ACTIVE");

    const [origin, destination, rateSnapshot] = await Promise.all([
      getActiveCommune(dispatchSettings.originCommuneCode),
      getActiveCommune(value.destinationCommuneCode),
      db.collection("rateCards").doc(rateSettings.activeVersion).get(),
    ]);
    if (!rateSnapshot.exists) throw new ApiError(503, "RATE_CARD_NOT_ACTIVE");
    const zoneId = zoneBetween(origin, destination);
    const calculation = quoteParcels(rateSnapshot.data() as RateCard, value.parcels, zoneId);
    const quoteId = randomUUID();
    const expiresAt = Timestamp.fromMillis(Date.now() + 15 * 60 * 1000);
    const quote = {
      quoteId,
      checkoutRef: value.checkoutRef,
      status: "open",
      rateVersion: calculation.rateVersion,
      zoneId,
      originCommuneCode: origin.code,
      destinationCommuneCode: destination.code,
      destinationName: destination.name,
      destinationDepartmentCode: destination.departmentCode,
      amountHtg: calculation.totalHtg,
      currency: "HTG",
      parcels: calculation.parcels,
      requestHash: bodyHash,
      createdAt: FieldValue.serverTimestamp(),
      expiresAt,
    };

    await db.runTransaction(async (transaction) => {
      const raced = await transaction.get(idempotencyRef);
      if (raced.exists) {
        if (raced.get("requestHash") !== bodyHash) throw new ApiError(409, "IDEMPOTENCY_KEY_REUSED");
        throw new ApiError(409, "QUOTE_REQUEST_IN_PROGRESS");
      }
      transaction.create(db.collection("quotes").doc(quoteId), quote);
      transaction.create(idempotencyRef, {
        requestHash: bodyHash,
        quoteId,
        checkoutRef: value.checkoutRef,
        createdAt: FieldValue.serverTimestamp(),
      });
    });
    return jsonOk(quoteDto({ ...quote, expiresAt } as unknown as DocumentData), 201);
  } catch (error) {
    if (error instanceof Error && "code" in error && typeof (error as { code?: unknown }).code === "string") {
      const code = (error as { code: string }).code;
      if (["RATE_CARD_NOT_ACTIVE", "RATE_CARD_NOT_YET_EFFECTIVE", "RATE_CARD_EXPIRED", "ZONE_RATE_NOT_CONFIGURED", "MANUAL_QUOTE_REQUIRED", "QUOTE_AMOUNT_INVALID"].includes(code)) {
        return Response.json({ error: code }, { status: 503, headers: { "Cache-Control": "private, no-store" } });
      }
    }
    return apiFailure(error);
  }
}
