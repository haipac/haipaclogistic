import { getFirebaseAdminDb } from "@/lib/firebase/admin";
import { requireUser } from "@/lib/firebase/auth";
import { ensureAccount, accountDto } from "@/lib/account/profiles";
import { apiFailure, jsonOk } from "@/lib/api/http";


export async function GET(request: Request) {
  try {
    const user = await requireUser(request);
    const db = getFirebaseAdminDb();
    const [snapshot, shipmentSnapshot, addressSnapshot] = await Promise.all([
      db.collection("users").doc(user.uid).get(),
      db.collection("shipments").where("recipientUid", "==", user.uid).orderBy("createdAt", "desc").limit(50).get(),
      db.collection("users").doc(user.uid).collection("addresses").orderBy("createdAt", "desc").limit(20).get(),
    ]);
    const shipments = shipmentSnapshot.docs.map((doc) => ({
      trackingNumber: doc.get("trackingNumber"),
      status: doc.get("status"),
      createdAt: doc.get("createdAt")?.toDate?.().toISOString?.() ?? null,
    }));
    const addresses = addressSnapshot.docs.map((doc) => ({
      id: doc.id,
      label: doc.get("label"),
      recipientName: doc.get("recipientName"),
      phone: doc.get("phone"),
      department: doc.get("department"),
      communeCode: doc.get("communeCode"),
      locality: doc.get("locality"),
      addressLine: doc.get("addressLine"),
      directions: doc.get("directions"),
    }));
    return jsonOk({ account: accountDto(user.uid, snapshot.data()), shipments, addresses });
  } catch (error) {
    return apiFailure(error);
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireUser(request);
    if (!user.email) return jsonOk({ error: "EMAIL_REQUIRED" }, 422);
    const profile = await ensureAccount(user.uid, user.email);
    return jsonOk({ account: accountDto(user.uid, profile) }, 201);
  } catch (error) {
    return apiFailure(error);
  }
}
