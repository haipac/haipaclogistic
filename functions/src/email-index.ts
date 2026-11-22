import { onSchedule } from "firebase-functions/v2/scheduler";
import { defineSecret, defineString } from "firebase-functions/params";
import { processEmailOutbox } from "./api";

const functionRegion = defineString("HAIPAC_FUNCTION_REGION", { default: "us-east4" });
const runtimeServiceAccount = defineString("HAIPAC_RUNTIME_SERVICE_ACCOUNT", {
  default: "haipac-functions-runtime@haipac-7e19d.iam.gserviceaccount.com",
});
const emailFrom = defineString("EMAIL_FROM", { default: "" });
const emailProviderConfigured = defineString("EMAIL_PROVIDER_CONFIGURED", { default: "false" });
const legalContentApproved = defineString("LEGAL_CONTENT_APPROVED", { default: "false" });
const operationsReady = defineString("OPERATIONS_READY", { default: "false" });

const claimTokenEncryptionKey = defineSecret("CLAIM_TOKEN_ENCRYPTION_KEY");
const resendApiKey = defineSecret("RESEND_API_KEY");
const cronSecret = defineSecret("CRON_SECRET");

export const processHaipacEmailOutbox = onSchedule(
  {
    schedule: "every 1 minutes",
    timeZone: "America/Port-au-Prince",
    region: functionRegion,
    serviceAccount: runtimeServiceAccount,
    timeoutSeconds: 60,
    memory: "256MiB",
    maxInstances: 1,
    secrets: [claimTokenEncryptionKey, resendApiKey, cronSecret],
  },
  async () => {
    if (
      emailProviderConfigured.value() !== "true" ||
      legalContentApproved.value() !== "true" ||
      operationsReady.value() !== "true"
    ) return;
    process.env.EMAIL_FROM = emailFrom.value();
    process.env.EMAIL_PROVIDER_CONFIGURED = emailProviderConfigured.value();
    process.env.LEGAL_CONTENT_APPROVED = legalContentApproved.value();
    process.env.OPERATIONS_READY = operationsReady.value();
    const authorizationSecret = cronSecret.value();
    const response = await processEmailOutbox(
      new Request("https://haipac.internal/api/v1/internal/process-email-outbox", {
        method: "POST",
        headers: { authorization: `Bearer ${authorizationSecret}` },
      }),
    );
    if (!response.ok) throw new Error("HAIPAC_EMAIL_OUTBOX_PROCESSING_FAILED");
  },
);
