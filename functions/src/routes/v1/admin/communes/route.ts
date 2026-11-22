import { getFirebaseAdminDb } from "@/lib/firebase/admin";
import { requireAdmin } from "@/lib/firebase/auth";
import { apiFailure, jsonOk } from "@/lib/api/http";


export async function GET(request: Request) {
  try {
    await requireAdmin(request);
    const snapshot = await getFirebaseAdminDb().collection("communes").orderBy("name").limit(500).get();
    return jsonOk({ communes: snapshot.docs.map((doc) => ({ code: doc.id, ...doc.data() })) });
  } catch (error) {
    return apiFailure(error);
  }
}
