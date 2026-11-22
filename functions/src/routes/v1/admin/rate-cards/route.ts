import { getFirebaseAdminDb } from "@/lib/firebase/admin";
import { requireAdmin } from "@/lib/firebase/auth";
import { apiFailure, jsonOk } from "@/lib/api/http";


export async function GET(request: Request) {
  try {
    await requireAdmin(request);
    const db = getFirebaseAdminDb();
    const [settings, cards] = await Promise.all([
      db.collection("settings").doc("rates").get(),
      db.collection("rateCards").orderBy("updatedAt", "desc").limit(20).get(),
    ]);
    return jsonOk({ activeVersion: settings.get("activeVersion") ?? null, rateCards: cards.docs.map((doc) => ({ id: doc.id, ...doc.data() })) });
  } catch (error) {
    return apiFailure(error);
  }
}
