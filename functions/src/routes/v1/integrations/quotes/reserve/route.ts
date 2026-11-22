import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { z } from "zod";
import { ApiError } from "@/lib/firebase/auth";
import { apiFailure, jsonOk } from "@/lib/api/http";
import { getFirebaseAdminDb } from "@/lib/firebase/admin";
import { sha256 } from "@/lib/security/secrets";
import { getIdempotencyKey, verifySmartCutRequest } from "@/lib/integrations/smartcut-signature";
import { requireProductionReadiness } from "@/lib/api/production-readiness";


const ReservationSchema = z.object({
  quoteId: z.string().uuid(),
  checkoutRef: z.string().trim().min(16).max(100),
  smartCutOrderId: z.string().trim().min(1).max(100),
}).strict();

export async function POST(request: Request) {
  try {
    await requireProductionReadiness();
    if (!request.headers.get("content-type")?.toLowerCase().includes("application/json")) throw new ApiError(415, "JSON_REQUIRED");
    const rawBody = await request.text();
    if (new TextEncoder().encode(rawBody).byteLength > 8 * 1024) throw new ApiError(413, "REQUEST_TOO_LARGE");
    const { bodyHash } = await verifySmartCutRequest(request, rawBody);
    const idempotencyKey = getIdempotencyKey(request);
    let body: unknown;
    try { body = JSON.parse(rawBody) as unknown; } catch { throw new ApiError(400, "INVALID_JSON"); }
    const parsed = ReservationSchema.safeParse(body);
    if (!parsed.success) throw new ApiError(400, "QUOTE_RESERVATION_INVALID");

    const input = parsed.data;
    const db = getFirebaseAdminDb();
    const quoteRef = db.collection("quotes").doc(input.quoteId);
    const idempotencyRef = db.collection("integrationIdempotency").doc(`reservation_${sha256(idempotencyKey)}`);
    const paymentExpiresAt = Timestamp.fromMillis(Date.now() + 20 * 60 * 1000);

    await db.runTransaction(async (transaction) => {
      const [prior, quote] = await Promise.all([transaction.get(idempotencyRef), transaction.get(quoteRef)]);
      if (prior.exists) {
        if (prior.get("requestHash") !== bodyHash) throw new ApiError(409, "IDEMPOTENCY_KEY_REUSED");
        return;
      }
      if (!quote.exists || quote.get("checkoutRef") !== input.checkoutRef) throw new ApiError(404, "QUOTE_NOT_FOUND");
      if (quote.get("status") !== "open") throw new ApiError(409, "QUOTE_NO_LONGER_AVAILABLE");
      if ((quote.get("expiresAt")?.toMillis?.() ?? 0) <= Date.now()) throw new ApiError(409, "QUOTE_EXPIRED");

      transaction.update(quoteRef, {
        status: "payment_pending",
        smartCutOrderId: input.smartCutOrderId,
        paymentExpiresAt,
        reservationCreatedAt: FieldValue.serverTimestamp(),
      });
      transaction.create(idempotencyRef, {
        requestHash: bodyHash,
        quoteId: input.quoteId,
        checkoutRef: input.checkoutRef,
        smartCutOrderId: input.smartCutOrderId,
        paymentExpiresAt,
        createdAt: FieldValue.serverTimestamp(),
      });
    });

    const quote = await quoteRef.get();
    return jsonOk({
      quoteId: input.quoteId,
      smartCutOrderId: input.smartCutOrderId,
      amountHtg: quote.get("amountHtg"),
      paymentExpiresAt: quote.get("paymentExpiresAt")?.toDate?.().toISOString?.() ?? null,
    });
  } catch (error) {
    return apiFailure(error);
  }
}
