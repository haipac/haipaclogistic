import assert from "node:assert/strict";
import test from "node:test";
import { hasPublishedLegalDocument, isLegalDocumentId, LegalDocumentDraftSchema, serializeLegalDocument } from "./legal-content";

test("legal content accepts only the two public documents", () => {
  assert.equal(isLegalDocumentId("conditions"), true);
  assert.equal(isLegalDocumentId("confidentialite"), true);
  assert.equal(isLegalDocumentId("admin"), false);
  assert.equal(isLegalDocumentId("conditions/versions"), false);
});

test("legal drafts require a title and enough plain-text content", () => {
  const draft = {
    title: "Conditions d’utilisation",
    body: "# Conditions\n\n" + "Contenu validé à rédiger par l’administrateur. ".repeat(3),
  };
  assert.equal(LegalDocumentDraftSchema.safeParse(draft).success, true);
  assert.equal(LegalDocumentDraftSchema.safeParse({ ...draft, title: "abc" }).success, false);
  assert.equal(LegalDocumentDraftSchema.safeParse({ ...draft, body: "court" }).success, false);
  assert.equal(LegalDocumentDraftSchema.safeParse({ ...draft, body: "x".repeat(30_001) }).success, false);
});

test("public serialization returns only a valid published version", () => {
  const timestamp = { toDate: () => new Date("2026-11-17T12:00:00.000Z") };
  const document = serializeLegalDocument({
    draft: { title: "Draft secret", body: "Draft content", updatedAt: timestamp },
    published: { title: "Public terms", body: "Published content", version: 2, publishedAt: timestamp },
  });
  assert.equal(hasPublishedLegalDocument({ published: { version: 2, title: "Public terms", body: "Published content", publishedAt: timestamp } }), true);
  assert.deepEqual(document.published, {
    title: "Public terms",
    body: "Published content",
    version: 2,
    publishedAt: "2026-11-17T12:00:00.000Z",
  });
  assert.equal(JSON.stringify(document.published).includes("Draft secret"), false);
  assert.equal(hasPublishedLegalDocument({ published: { version: 0, title: "Public terms", body: "Published content", publishedAt: timestamp } }), false);
  assert.equal(hasPublishedLegalDocument({ published: { version: 1, title: "Public terms", body: "Published content" } }), false);
});
