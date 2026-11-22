import { ApiError } from "@/lib/firebase/auth";
import { getFirebaseAdminDb } from "@/lib/firebase/admin";
import { PRODUCTION_FIREBASE_PROJECT_ID } from "@/lib/firebase/project-ids";
import { hasPublishedLegalDocument } from "@/lib/legal-content";
import { hasPublishedAdminPolicy } from "@/lib/admin-policies";

type ProductionReadinessDocuments = {
  conditions: Record<string, unknown> | undefined;
  privacy: Record<string, unknown> | undefined;
  retentionPolicy: Record<string, unknown> | undefined;
  operationsProcedures: Record<string, unknown> | undefined;
  paymentPolicy: Record<string, unknown> | undefined;
};

export function hasPublishedProductionReadinessDocuments(documents: ProductionReadinessDocuments) {
  return hasPublishedLegalDocument(documents.conditions) &&
    hasPublishedLegalDocument(documents.privacy) &&
    hasPublishedAdminPolicy(documents.retentionPolicy) &&
    hasPublishedAdminPolicy(documents.operationsProcedures) &&
    hasPublishedAdminPolicy(documents.paymentPolicy);
}

export async function requireProductionReadiness() {
  const projectId = process.env.GCLOUD_PROJECT ?? process.env.GCP_PROJECT ?? process.env.FIREBASE_PROJECT_ID;
  const isEmulator = Boolean(
    process.env.FUNCTIONS_EMULATOR ||
    process.env.FIRESTORE_EMULATOR_HOST ||
    process.env.FIREBASE_AUTH_EMULATOR_HOST,
  );

  if (!isEmulator && projectId !== PRODUCTION_FIREBASE_PROJECT_ID) {
    throw new ApiError(503, "SERVICE_NOT_READY");
  }

  if (
    !isEmulator &&
    (process.env.LEGAL_CONTENT_APPROVED !== "true" || process.env.OPERATIONS_READY !== "true")
  ) {
    throw new ApiError(503, "SERVICE_NOT_READY");
  }

  if (!isEmulator) {
    const db = getFirebaseAdminDb();
    const [conditions, privacy, retentionPolicy, operationsProcedures, paymentPolicy] = await Promise.all([
      db.collection("legalDocuments").doc("conditions").get(),
      db.collection("legalDocuments").doc("confidentialite").get(),
      db.collection("operationalPolicies").doc("data-retention").get(),
      db.collection("operationalPolicies").doc("operations").get(),
      db.collection("operationalPolicies").doc("payments").get(),
    ]);
    if (!hasPublishedProductionReadinessDocuments({
      conditions: conditions.data(),
      privacy: privacy.data(),
      retentionPolicy: retentionPolicy.data(),
      operationsProcedures: operationsProcedures.data(),
      paymentPolicy: paymentPolicy.data(),
    })) {
      throw new ApiError(503, "SERVICE_NOT_READY");
    }
  }
}
