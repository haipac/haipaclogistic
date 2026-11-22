import assert from "node:assert/strict";
import test from "node:test";
import { hasPublishedProductionReadinessDocuments } from "./production-readiness";

const publishedAt = { toDate: () => new Date("2026-11-17T12:00:00.000Z") };
const documents = {
  conditions: { published: { title: "Conditions", body: "Texte final des conditions", version: 1, publishedAt } },
  privacy: { published: { title: "Confidentialité", body: "Texte final de confidentialité", version: 1, publishedAt } },
  retentionPolicy: {
    published: {
      title: "Conservation des données",
      body: "Politique validée de conservation des données. ".repeat(3),
      version: 1,
      publishedAt,
    },
  },
  operationsProcedures: {
    published: {
      title: "Procédures opérationnelles",
      body: "Procédures validées pour l’exploitation et la livraison. ".repeat(3),
      version: 1,
      publishedAt,
    },
  },
  paymentPolicy: {
    published: {
      title: "Paiements et remboursements",
      body: "Politique validée sur les paiements, confirmations et remboursements. ".repeat(2),
      version: 1,
      publishedAt,
    },
  },
};

test("production readiness requires legal, operational, and payment policies to be published", () => {
  assert.equal(hasPublishedProductionReadinessDocuments(documents), true);
  assert.equal(hasPublishedProductionReadinessDocuments({ ...documents, conditions: undefined }), false);
  assert.equal(hasPublishedProductionReadinessDocuments({ ...documents, privacy: undefined }), false);
  assert.equal(hasPublishedProductionReadinessDocuments({ ...documents, retentionPolicy: undefined }), false);
  assert.equal(hasPublishedProductionReadinessDocuments({ ...documents, operationsProcedures: undefined }), false);
  assert.equal(hasPublishedProductionReadinessDocuments({ ...documents, paymentPolicy: undefined }), false);
});
