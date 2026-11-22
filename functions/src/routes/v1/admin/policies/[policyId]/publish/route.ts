import { FieldValue } from "firebase-admin/firestore";
import { ApiError, requireAdmin } from "@/lib/firebase/auth";
import { apiFailure, jsonOk, readJson } from "@/lib/api/http";
import { getFirebaseAdminDb } from "@/lib/firebase/admin";
import { AdminPolicyDraftSchema, isAdminPolicyId } from "@/lib/admin-policies";

export async function POST(request: Request, context: { params: Promise<{ policyId: string }> }) {
  try {
    const admin = await requireAdmin(request);
    const { policyId } = await context.params;
    if (!isAdminPolicyId(policyId)) return jsonOk({ error: "ADMIN_POLICY_NOT_FOUND" }, 404);
    const confirmation = await readJson(request, 4 * 1024);
    if (!confirmation || typeof confirmation !== "object" || (confirmation as { confirm?: unknown }).confirm !== true) {
      return jsonOk({ error: "ADMIN_POLICY_CONFIRMATION_REQUIRED" }, 400);
    }

    const db = getFirebaseAdminDb();
    const policyRef = db.collection("operationalPolicies").doc(policyId);
    const auditRef = db.collection("adminAuditLog").doc();
    const publishedVersion = await db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(policyRef);
      const storedDraft = snapshot.get("draft") as { title?: unknown; body?: unknown } | undefined;
      const draft = AdminPolicyDraftSchema.safeParse({ title: storedDraft?.title, body: storedDraft?.body });
      if (!draft.success) throw new ApiError(409, "ADMIN_POLICY_DRAFT_REQUIRED");
      const published = snapshot.get("published") as { title?: unknown; body?: unknown } | undefined;
      if (published?.title === draft.data.title && published.body === draft.data.body) {
        throw new ApiError(409, "ADMIN_POLICY_UNCHANGED");
      }

      const currentVersion = snapshot.get("published.version");
      const nextVersion = (typeof currentVersion === "number" && Number.isSafeInteger(currentVersion) && currentVersion > 0 ? currentVersion : 0) + 1;
      const versionRef = policyRef.collection("versions").doc(String(nextVersion));
      const publication = {
        ...draft.data,
        version: nextVersion,
        publishedAt: FieldValue.serverTimestamp(),
        publishedBy: admin.uid,
      };
      transaction.create(versionRef, publication);
      transaction.set(policyRef, { published: publication }, { merge: true });
      transaction.create(auditRef, {
        actorUid: admin.uid,
        action: "admin_policy_published",
        targetId: policyId,
        version: nextVersion,
        createdAt: FieldValue.serverTimestamp(),
      });
      return nextVersion;
    });

    return jsonOk({ policyId, version: publishedVersion });
  } catch (error) {
    return apiFailure(error);
  }
}
