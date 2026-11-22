import assert from "node:assert/strict";
import test from "node:test";
import {
  AdminPolicyDraftSchema,
  hasPublishedAdminPolicy,
  isAdminPolicyId,
  serializeAdminPolicy,
} from "./admin-policies";

test("admin policies accept retention, operations, and payment decisions", () => {
  assert.equal(isAdminPolicyId("data-retention"), true);
  assert.equal(isAdminPolicyId("operations"), true);
  assert.equal(isAdminPolicyId("payments"), true);
  assert.equal(isAdminPolicyId("support"), false);
  assert.equal(isAdminPolicyId("conditions"), false);
});

test("admin policy drafts require a title and complete content", () => {
  const draft = { title: "Procédures opérationnelles", body: "## Procédure\n\n" + "Règles à valider par l’administrateur. ".repeat(3) };
  assert.equal(AdminPolicyDraftSchema.safeParse(draft).success, true);
  assert.equal(AdminPolicyDraftSchema.safeParse({ ...draft, title: "abc" }).success, false);
  assert.equal(AdminPolicyDraftSchema.safeParse({ ...draft, body: "court" }).success, false);
  assert.equal(AdminPolicyDraftSchema.safeParse({ ...draft, body: "x".repeat(30_001) }).success, false);
  assert.equal(AdminPolicyDraftSchema.safeParse({ ...draft, uid: "unexpected" }).success, false);
});

test("admin serialization excludes editor identities and accepts only dated published versions", () => {
  const timestamp = { toDate: () => new Date("2026-11-17T12:00:00.000Z") };
  const document = serializeAdminPolicy({
    draft: { title: "Draft", body: "Draft body that is long enough to remain a valid operational policy draft with enough content for validation.", updatedAt: timestamp, updatedBy: "private-uid" },
    published: { title: "Approved retention", body: "Published policy content that is long enough to satisfy the minimum content rules for a validated internal policy.", version: 1, publishedAt: timestamp, publishedBy: "private-uid" },
  });
  assert.equal(document.draft?.updatedAt, "2026-11-17T12:00:00.000Z");
  assert.equal(JSON.stringify(document).includes("private-uid"), false);
  assert.equal(hasPublishedAdminPolicy({ published: { title: "Valid policy", body: "Published policy content that is long enough to satisfy the minimum content rules for a validated internal policy.", version: 1, publishedAt: timestamp } }), true);
  assert.equal(hasPublishedAdminPolicy({ published: { title: "x", body: "y", version: 1, publishedAt: timestamp } }), false);
  assert.equal(hasPublishedAdminPolicy({ published: { title: "x", body: "y", version: 1 } }), false);
  assert.equal(hasPublishedAdminPolicy(undefined), false);
});
