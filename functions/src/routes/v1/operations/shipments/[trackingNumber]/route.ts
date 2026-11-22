import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { randomInt } from "node:crypto";
import { z } from "zod";
import { getFirebaseAdminDb } from "@/lib/firebase/admin";
import { requireOperations, ApiError } from "@/lib/firebase/auth";
import { apiFailure, jsonOk, readJson } from "@/lib/api/http";
import { queueEmail } from "@/lib/email/outbox";
import { hashDeliveryCode } from "@/lib/security/secrets";
import { canTransition, SHIPMENT_STATUSES, STATUS_LABELS } from "@/lib/logistics/shipments";


const StatusUpdateSchema = z.object({
  expectedStatus: z.enum(SHIPMENT_STATUSES),
  status: z.enum(SHIPMENT_STATUSES).refine((value) => value !== "delivered", "USE_DELIVER_ENDPOINT"),
}).strict();

export async function PATCH(request: Request, context: { params: Promise<{ trackingNumber: string }> }) {
  try {
    const operator = await requireOperations(request);
    const { trackingNumber: raw } = await context.params;
    const trackingNumber = raw.trim().toUpperCase();
    if (!/^HPL\d{10}$/.test(trackingNumber)) throw new ApiError(400, "TRACKING_NUMBER_INVALID");
    const parsed = StatusUpdateSchema.safeParse(await readJson(request, 8 * 1024));
    if (!parsed.success) throw new ApiError(400, "SHIPMENT_UPDATE_INVALID");
    const { status: nextStatus, expectedStatus } = parsed.data;
    const db = getFirebaseAdminDb();
    const trackingRef = db.collection("tracking").doc(trackingNumber);
    const shipmentId = (await trackingRef.get()).get("shipmentId");
    if (typeof shipmentId !== "string") throw new ApiError(404, "SHIPMENT_NOT_FOUND");
    const shipmentRef = db.collection("shipments").doc(shipmentId);
    const eventRef = db.collection("shipmentEvents").doc();
    const auditRef = db.collection("adminAuditLog").doc();
    const deliveryCode = nextStatus === "out_for_delivery" ? String(randomInt(100000, 1_000_000)) : null;
    const deliveryCodeHash = deliveryCode ? hashDeliveryCode(deliveryCode) : null;
    const codeExpiresAt = Timestamp.fromMillis(Date.now() + 24 * 60 * 60 * 1000);

    await db.runTransaction(async (transaction) => {
      const [shipmentSnapshot, trackingSnapshot] = await Promise.all([transaction.get(shipmentRef), transaction.get(trackingRef)]);
      if (!shipmentSnapshot.exists || !trackingSnapshot.exists) throw new ApiError(404, "SHIPMENT_NOT_FOUND");
      const currentStatus = String(shipmentSnapshot.get("status"));
      if (currentStatus !== expectedStatus) throw new ApiError(409, "SHIPMENT_STATUS_CHANGED");
      if (!canTransition(currentStatus, nextStatus)) throw new ApiError(409, "SHIPMENT_TRANSITION_INVALID");
      const update: Record<string, unknown> = {
        status: nextStatus,
        updatedAt: FieldValue.serverTimestamp(),
        deliveryCodeHash: deliveryCodeHash ?? FieldValue.delete(),
        deliveryCodeExpiresAt: deliveryCode ? codeExpiresAt : FieldValue.delete(),
        deliveryCodeAttemptCount: deliveryCode ? 0 : FieldValue.delete(),
      };
      transaction.update(shipmentRef, update);
      transaction.update(trackingRef, { status: nextStatus, updatedAt: FieldValue.serverTimestamp() });
      transaction.create(eventRef, {
        shipmentId,
        trackingNumber,
        status: nextStatus,
        isPublic: true,
        publicMessage: STATUS_LABELS[nextStatus],
        locationLabel: "",
        actorUid: operator.uid,
        createdAt: FieldValue.serverTimestamp(),
      });
      if (deliveryCode) {
        const email = String(shipmentSnapshot.get("recipientEmail") ?? "");
        queueEmail(transaction, db, {
          template: "delivery_code",
          to: email,
          subject: `Code de remise — colis ${trackingNumber}`,
          data: {
            trackingNumber,
            recipientName: String(shipmentSnapshot.get("recipientName") ?? ""),
            code: deliveryCode,
          },
        });
      }
      transaction.create(auditRef, { actorUid: operator.uid, action: "shipment_status_changed", targetId: trackingNumber, from: currentStatus, to: nextStatus, createdAt: FieldValue.serverTimestamp() });
    });
    return jsonOk({ trackingNumber, status: nextStatus, deliveryCodeQueued: Boolean(deliveryCode) });
  } catch (error) { return apiFailure(error); }
}
