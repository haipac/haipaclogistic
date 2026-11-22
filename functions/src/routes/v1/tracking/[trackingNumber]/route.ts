import { ApiError } from "@/lib/firebase/auth";
import { apiFailure, jsonOk } from "@/lib/api/http";
import { getFirebaseAdminDb } from "@/lib/firebase/admin";
import { STATUS_LABELS, type ShipmentStatus } from "@/lib/logistics/shipments";
import { enforceTrackingRateLimit } from "@/lib/logistics/tracking-rate-limit";


export async function GET(request: Request, context: { params: Promise<{ trackingNumber: string }> }) {
  try {
    const { trackingNumber: raw } = await context.params;
    const trackingNumber = raw.trim().toUpperCase();
    if (!/^HPL\d{10}$/.test(trackingNumber)) throw new ApiError(400, "TRACKING_NUMBER_INVALID");
    await enforceTrackingRateLimit(request);
    const db = getFirebaseAdminDb();
    const tracking = await db.collection("tracking").doc(trackingNumber).get();
    if (!tracking.exists) throw new ApiError(404, "TRACKING_NOT_FOUND");
    const shipment = await db.collection("shipments").doc(String(tracking.get("shipmentId"))).get();
    if (!shipment.exists) throw new ApiError(404, "TRACKING_NOT_FOUND");
    const status = String(shipment.get("status")) as ShipmentStatus;
    if (!Object.hasOwn(STATUS_LABELS, status)) throw new ApiError(503, "TRACKING_STATUS_INVALID");
    const events = await db.collection("shipmentEvents")
      .where("shipmentId", "==", shipment.id)
      .where("isPublic", "==", true)
      .orderBy("createdAt", "desc")
      .limit(10)
      .get();
    return jsonOk({
      trackingNumber,
      status: STATUS_LABELS[status],
      updatedAt: tracking.get("updatedAt")?.toDate?.().toISOString?.() ?? null,
      events: events.docs.map((event) => ({
        status: STATUS_LABELS[event.get("status") as ShipmentStatus] ?? "Mise à jour",
        location: typeof event.get("locationLabel") === "string" ? event.get("locationLabel") : null,
        message: typeof event.get("publicMessage") === "string" ? event.get("publicMessage") : null,
        createdAt: event.get("createdAt")?.toDate?.().toISOString?.() ?? null,
      })),
    });
  } catch (error) {
    return apiFailure(error);
  }
}
