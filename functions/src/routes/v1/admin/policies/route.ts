import { getFirebaseAdminDb } from "@/lib/firebase/admin";
import { apiFailure, jsonOk } from "@/lib/api/http";
import { requireAdmin } from "@/lib/firebase/auth";
import { ADMIN_POLICY_IDS, serializeAdminPolicy } from "@/lib/admin-policies";

export async function GET(request: Request) {
  try {
    await requireAdmin(request);
    const db = getFirebaseAdminDb();
    const snapshots = await Promise.all(
      ADMIN_POLICY_IDS.map((policyId) => db.collection("operationalPolicies").doc(policyId).get()),
    );
    const policies = Object.fromEntries(snapshots.map((snapshot, index) => [
      ADMIN_POLICY_IDS[index],
      snapshot.exists ? serializeAdminPolicy(snapshot.data() ?? {}) : { draft: null, published: null },
    ]));
    return jsonOk({ policies });
  } catch (error) {
    return apiFailure(error);
  }
}
