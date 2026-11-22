import { FieldValue } from "firebase-admin/firestore";
import { getFirebaseAdminDb } from "@/lib/firebase/admin";
import { apiFailure, jsonOk, readJson } from "@/lib/api/http";
import { requireAdmin } from "@/lib/firebase/auth";
import { AdminPolicyDraftSchema, isAdminPolicyId } from "@/lib/admin-policies";

export async function PUT(request: Request, context: { params: Promise<{ policyId: string }> }) {
  try {
    const admin = await requireAdmin(request);
    const { policyId } = await context.params;
    if (!isAdminPolicyId(policyId)) return jsonOk({ error: "ADMIN_POLICY_NOT_FOUND" }, 404);
    const parsed = AdminPolicyDraftSchema.safeParse(await readJson(request, 40 * 1024));
    if (!parsed.success) return jsonOk({ error: "ADMIN_POLICY_INVALID" }, 400);

    const db = getFirebaseAdminDb();
    const policyRef = db.collection("operationalPolicies").doc(policyId);
    const auditRef = db.collection("adminAuditLog").doc();
    await db.runTransaction(async (transaction) => {
      transaction.set(policyRef, {
        draft: {
          ...parsed.data,
          updatedAt: FieldValue.serverTimestamp(),
          updatedBy: admin.uid,
        },
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: admin.uid,
      }, { merge: true });
      transaction.create(auditRef, {
        actorUid: admin.uid,
        action: "admin_policy_draft_saved",
        targetId: policyId,
        createdAt: FieldValue.serverTimestamp(),
      });
    });
    return jsonOk({ policyId, status: "draft_saved" });
  } catch (error) {
    return apiFailure(error);
  }
}
