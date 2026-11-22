import assert from "node:assert/strict";
import test from "node:test";
import { prepareRoleAssignment } from "./user-roles";

test("assigns a verified operations role and preserves unrelated custom claims", () => {
  const result = prepareRoleAssignment({
    email: "dispatcher@example.com",
    emailVerified: true,
    customClaims: { tenant: "haipac", haipacRole: "customer" },
  }, "operations");

  assert.deepEqual(result, {
    ok: true,
    previousRole: "customer",
    nextRole: "operations",
    nextClaims: { tenant: "haipac", haipacRole: "operations" },
  });
});

test("removes only the HAIPAC role when returning a user to customer access", () => {
  const result = prepareRoleAssignment({
    email: "dispatcher@example.com",
    emailVerified: false,
    customClaims: { tenant: "haipac", haipacRole: "operations" },
  }, "customer");

  assert.deepEqual(result, {
    ok: true,
    previousRole: "operations",
    nextRole: "customer",
    nextClaims: { tenant: "haipac" },
  });
});

test("requires a verified email before assigning staff roles", () => {
  for (const role of ["admin", "operations"] as const) {
    const result = prepareRoleAssignment({ email: "staff@example.com", emailVerified: false }, role);
    assert.deepEqual(result, { ok: false, code: "STAFF_USER_EMAIL_UNVERIFIED" });
  }
});

test("protects the owner account from losing its admin role", () => {
  const result = prepareRoleAssignment({
    email: " HAIPACLOGISTICS@gmail.com ",
    emailVerified: true,
    customClaims: { haipacRole: "admin" },
  }, "operations");

  assert.deepEqual(result, { ok: false, code: "OWNER_ADMIN_ROLE_PROTECTED" });
});

test("does not assign the unconfigured support role", () => {
  const result = prepareRoleAssignment({ email: "support@example.com", emailVerified: true }, "support");
  assert.deepEqual(result, { ok: false, code: "SUPPORT_ROLE_NOT_CONFIGURED" });
});
