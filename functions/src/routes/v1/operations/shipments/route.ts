import { getFirebaseAdminDb } from "@/lib/firebase/admin";
import { requireOperations } from "@/lib/firebase/auth";
import { apiFailure, jsonOk } from "@/lib/api/http";
import { SHIPMENT_STATUSES } from "@/lib/logistics/shipments";


export async function GET(request: Request) {
  try {
    await requireOperations(request);
    const url = new URL(request.url);
    const status = url.searchParams.get("status");
    if (status && !SHIPMENT_STATUSES.includes(status as (typeof SHIPMENT_STATUSES)[number])) {
      return jsonOk({ error: "SHIPMENT_STATUS_INVALID" }, 400);
    }
    const shipments = getFirebaseAdminDb().collection("shipments");
    const query = status
      ? shipments.where("status", "==", status).orderBy("createdAt", "desc").limit(100)
      : shipments.where("status", "in", ["registered", "received", "in_transit", "out_for_delivery", "exception"]).orderBy("createdAt", "desc").limit(100);
    const snapshot = await query.get();
    return jsonOk({ shipments: snapshot.docs.map((doc) => ({
      trackingNumber: doc.get("trackingNumber"),
      status: doc.get("status"),
      recipientName: doc.get("recipientName"),
      recipientPhone: doc.get("recipientPhone"),
      destinationName: doc.get("destinationName"),
      destinationDepartmentCode: doc.get("destinationDepartmentCode"),
      locality: doc.get("locality"),
      addressLine: doc.get("addressLine"),
      directions: doc.get("directions"),
      createdAt: doc.get("createdAt")?.toDate?.().toISOString?.() ?? null,
    })) });
  } catch (error) { return apiFailure(error); }
}
