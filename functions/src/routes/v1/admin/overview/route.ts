import { getFirebaseAdminDb } from "@/lib/firebase/admin";
import { requireAdmin } from "@/lib/firebase/auth";
import { apiFailure, jsonOk } from "@/lib/api/http";
import { PRODUCTION_FIREBASE_PROJECT_ID } from "@/lib/firebase/project-ids";
import { hasPublishedLegalDocument } from "@/lib/legal-content";
import { hasPublishedAdminPolicy } from "@/lib/admin-policies";
import { getRateCardEffectiveDateError, RateCardSchema } from "@/lib/logistics/rates";

function configuredEnvironment(
  conditionsPublished: boolean,
  privacyPublished: boolean,
  retentionPolicyPublished: boolean,
  operationsProceduresPublished: boolean,
  paymentPolicyPublished: boolean,
) {
  const projectId = process.env.GCLOUD_PROJECT ?? process.env.GCP_PROJECT;
  const encryptionKey = Buffer.from(process.env.CLAIM_TOKEN_ENCRYPTION_KEY ?? "", "base64");
  return {
    firebaseAdminIdentity: projectId === PRODUCTION_FIREBASE_PROJECT_ID,
    smartCutSignature: (process.env.SMARTCUT_HMAC_SECRET?.length ?? 0) >= 32,
    secureClaimEmail: encryptionKey.length === 32,
    deliveryCodeSecret: (process.env.DELIVERY_CODE_SECRET?.length ?? 0) >= 32,
    trackingRateLimit: (process.env.TRACKING_RATE_LIMIT_SECRET?.length ?? 0) >= 32,
    emailProvider: process.env.EMAIL_PROVIDER_CONFIGURED === "true",
    cronSecret: (process.env.CRON_SECRET?.length ?? 0) >= 32,
    legalContentApproved: process.env.LEGAL_CONTENT_APPROVED === "true",
    conditionsPublished,
    privacyPublished,
    retentionPolicyPublished,
    operationsProceduresPublished,
    paymentPolicyPublished,
    operationsReady: process.env.OPERATIONS_READY === "true",
    publicUrlConfigured: Boolean(process.env.HAIPAC_PUBLIC_URL?.startsWith("https://")),
  };
}


export async function GET(request: Request) {
  try {
    await requireAdmin(request);
    const db = getFirebaseAdminDb();
    const [rates, dispatch, communeCount, shipments, pendingEmailCount, conditions, privacy, retentionPolicy, operationsProcedures, paymentPolicy] = await Promise.all([
      db.collection("settings").doc("rates").get(),
      db.collection("settings").doc("dispatch").get(),
      db.collection("communes").where("active", "==", true).count().get(),
      db.collection("shipments").where("status", "in", ["registered", "received", "in_transit", "out_for_delivery", "exception"]).count().get(),
      db.collection("emailOutbox").where("status", "==", "pending").count().get(),
      db.collection("legalDocuments").doc("conditions").get(),
      db.collection("legalDocuments").doc("confidentialite").get(),
      db.collection("operationalPolicies").doc("data-retention").get(),
      db.collection("operationalPolicies").doc("operations").get(),
      db.collection("operationalPolicies").doc("payments").get(),
    ]);
    const environment = {
      ...configuredEnvironment(
        hasPublishedLegalDocument(conditions.data()),
        hasPublishedLegalDocument(privacy.data()),
        hasPublishedAdminPolicy(retentionPolicy.data()),
        hasPublishedAdminPolicy(operationsProcedures.data()),
        hasPublishedAdminPolicy(paymentPolicy.data()),
      ),
      rateCardEffective: false,
    };
    const activeRateVersion = rates.get("activeVersion");
    const activeRateSnapshot = typeof activeRateVersion === "string"
      ? await db.collection("rateCards").doc(activeRateVersion).get()
      : null;
    const activeRate = activeRateSnapshot?.data();
    const parsedActiveRate = RateCardSchema.safeParse(activeRate);
    const rateCardDateError = !parsedActiveRate.success || parsedActiveRate.data.status !== "active"
      ? "RATE_CARD_NOT_ACTIVE"
      : getRateCardEffectiveDateError(parsedActiveRate.data);
    environment.rateCardEffective = rateCardDateError === null;
    const readinessChecks = [
      Boolean(dispatch.get("originCommuneCode")),
      communeCount.data().count > 0,
      ...Object.values(environment),
    ];
    return jsonOk({
      activeRateVersion: typeof activeRateVersion === "string" ? activeRateVersion : null,
      rateCardDateError,
      originCommuneCode: dispatch.get("originCommuneCode") ?? null,
      activeCommuneCount: communeCount.data().count,
      openShipmentCount: shipments.data().count,
      pendingEmailCount: pendingEmailCount.data().count,
      environment,
      productionReady: readinessChecks.every(Boolean),
    });
  } catch (error) {
    return apiFailure(error);
  }
}
