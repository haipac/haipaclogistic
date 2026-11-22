export type HaipacRole = "admin" | "operations" | "support" | "customer";

type RoleTarget = {
  email?: string;
  emailVerified: boolean;
  customClaims?: Record<string, unknown>;
};

type RoleAssignmentPlan =
  | { ok: true; previousRole: string; nextRole: HaipacRole; nextClaims: Record<string, unknown> }
  | { ok: false; code: "OWNER_ADMIN_ROLE_PROTECTED" | "SUPPORT_ROLE_NOT_CONFIGURED" | "STAFF_USER_EMAIL_UNVERIFIED" };

const OWNER_EMAIL = "haipaclogistics@gmail.com";

export function prepareRoleAssignment(target: RoleTarget, nextRole: HaipacRole): RoleAssignmentPlan {
  const previousRole = String(target.customClaims?.haipacRole ?? "customer");
  if (target.email?.trim().toLowerCase() === OWNER_EMAIL && nextRole !== "admin") {
    return { ok: false, code: "OWNER_ADMIN_ROLE_PROTECTED" };
  }
  if (nextRole === "support") return { ok: false, code: "SUPPORT_ROLE_NOT_CONFIGURED" };
  if (nextRole !== "customer" && !target.emailVerified) {
    return { ok: false, code: "STAFF_USER_EMAIL_UNVERIFIED" };
  }

  const nextClaims = { ...(target.customClaims ?? {}) };
  if (nextRole === "customer") delete nextClaims.haipacRole;
  else nextClaims.haipacRole = nextRole;

  return { ok: true, previousRole, nextRole, nextClaims };
}
