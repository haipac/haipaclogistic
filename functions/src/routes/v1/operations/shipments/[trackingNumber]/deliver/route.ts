import { FieldValue } from "firebase-admin/firestore";
import { z } from "zod";
import { getFirebaseAdminDb } from "@/lib/firebase/admin";
import { requireOperations, ApiError } from "@/lib/firebase/auth";
import { apiFailure, jsonOk, readJson } from "@/lib/api/http";
import { hashDeliveryCode, safeEqualHex } from "@/lib/security/secrets";
import { STATUS_LABELS } from "@/lib/logistics/shipments";


const DeliverySchema = z.object({ code: z.string().regex(/^\d{6}$/) }).strict();

export async function POST(request: Request, context: { params: Promise<{ trackingNumber: string }> }) {
  try {
    const operator = await requireOperations(request);
    const { trackingNumber: raw } = await context.params;
    const trackingNumber = raw.trim().toUpperCase();
    if (!/^HPL\d{10}$/.test(trackingNumber)) throw new ApiError(400, "TRACKING_NUMBER_INVALID");
    const parsed = DeliverySchema.safeParse(await readJson(request, 4 * 1024));
    if (!parsed.success) throw new ApiError(400, "DELIVERY_CODE_INVALID");
    const suppliedHash = hashDeliveryCode(parsed.data.code);
    const db = getFirebaseAdminDb();
    const trackingRef = db.collection("tracking").doc(trackingNumber);
    const shipmentId = (await trackingRef.get()).get("shipmentId");
    if (typeof shipmentId !== "string") throw new ApiError(404, "SHIPMENT_NOT_FOUND");
    const shipmentRef = db.collection("shipments").doc(shipmentId);
    const eventRef = db.collection("shipmentEvents").doc();
    const auditRef = db.collection("adminAuditLog").doc();
    const delivered = await db.runTransaction(async (transaction) => {
      const [shipmentSnapshot, trackingSnapshot] = await Promise.all([transaction.get(shipmentRef), transaction.get(trackingRef)]);
      if (!shipmentSnapshot.exists || !trackingSnapshot.exists) throw new ApiError(404, "SHIPMENT_NOT_FOUND");
      if (shipmentSnapshot.get("status") !== "out_for_delivery") throw new ApiError(409, "SHIPMENT_NOT_OUT_FOR_DELIVERY");
      const expiresAt = shipmentSnapshot.get("deliveryCodeExpiresAt")?.toDate?.().getTime?.() ?? 0;
      if (expiresAt <= Date.now()) throw new ApiError(410, "DELIVERY_CODE_EXPIRED");
      const attempts = Number(shipmentSnapshot.get("deliveryCodeAttemptCount") ?? 0);
      if (attempts >= 5) throw new ApiError(429, "DELIVERY_CODE_ATTEMPTS_EXCEEDED");
      const storedHash = String(shipmentSnapshot.get("deliveryCodeHash") ?? "");
      if (!safeEqualHex(storedHash, suppliedHash)) {
        transaction.update(shipmentRef, { deliveryCodeAttemptCount: attempts + 1, updatedAt: FieldValue.serverTimestamp() });
        return false;
      }
      transaction.update(shipmentRef, {
        status: "delivered",
        deliveredAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        deliveryCodeHash: FieldValue.delete(),
        deliveryCodeExpiresAt: FieldValue.delete(),
      });
      transaction.update(trackingRef, { status: "delivered", updatedAt: FieldValue.serverTimestamp() });
      transaction.create(eventRef, {
        shipmentId,
        trackingNumber,
        status: "delivered",
        isPublic: true,
        publicMessage: STATUS_LABELS.delivered,
        locationLabel: "",
        actorUid: operator.uid,
        createdAt: FieldValue.serverTimestamp(),
      });
      transaction.create(auditRef, { actorUid: operator.uid, action: "shipment_delivered", targetId: trackingNumber, createdAt: FieldValue.serverTimestamp() });
      return true;
    });
    if (!delivered) throw new ApiError(403, "DELIVERY_CODE_MISMATCH");
    return jsonOk({ trackingNumber, status: "delivered" });
  } catch (error) { return apiFailure(error); }
}
