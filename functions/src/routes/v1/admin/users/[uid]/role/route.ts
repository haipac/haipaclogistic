import { FieldValue } from "firebase-admin/firestore";
import { z } from "zod";
import { getFirebaseAdminAuth, getFirebaseAdminDb } from "@/lib/firebase/admin";
import { requireAdmin, ApiError } from "@/lib/firebase/auth";
import { apiFailure, jsonOk, readJson } from "@/lib/api/http";
import { prepareRoleAssignment } from "@/lib/firebase/user-roles";


const RoleSchema = z.object({ role: z.enum(["admin", "operations", "support", "customer"]) }).strict();

export async function PUT(request: Request, context: { params: Promise<{ uid: string }> }) {
  try {
    const actor = await requireAdmin(request);
    const { uid } = await context.params;
    if (!/^[A-Za-z0-9:_-]{1,128}$/.test(uid)) throw new ApiError(400, "USER_ID_INVALID");
    const parsed = RoleSchema.safeParse(await readJson(request, 4 * 1024));
    if (!parsed.success) throw new ApiError(400, "ROLE_INVALID");
    const auth = getFirebaseAdminAuth();
    const target = await auth.getUser(uid);
    const assignment = prepareRoleAssignment(target, parsed.data.role);
    if (!assignment.ok) throw new ApiError(409, assignment.code);
    await auth.setCustomUserClaims(uid, assignment.nextClaims);
    await getFirebaseAdminDb().collection("adminAuditLog").add({
      actorUid: actor.uid,
      action: "user_role_changed",
      targetId: uid,
      previousRole: assignment.previousRole,
      nextRole: assignment.nextRole,
      role: assignment.nextRole,
      createdAt: FieldValue.serverTimestamp(),
    });
    return jsonOk({ uid, role: assignment.nextRole, tokenRefreshRequired: true });
  } catch (error) { return apiFailure(error); }
}
