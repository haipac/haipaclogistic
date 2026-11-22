import { onRequest } from "firebase-functions/v2/https";
import { defineSecret, defineString } from "firebase-functions/params";
import { handleApiRequest } from "./api";

const functionRegion = defineString("HAIPAC_FUNCTION_REGION", { default: "us-east4" });
const runtimeServiceAccount = defineString("HAIPAC_RUNTIME_SERVICE_ACCOUNT", {
  default: "haipac-functions-runtime@haipac-7e19d.iam.gserviceaccount.com",
});
const legalApproved = defineString("LEGAL_CONTENT_APPROVED", { default: "false" });
const operationsReady = defineString("OPERATIONS_READY", { default: "false" });
const publicUrl = defineString("HAIPAC_PUBLIC_URL", { default: "https://haipac-7e19d.web.app" });
const emailFrom = defineString("EMAIL_FROM", { default: "" });
const emailProviderConfigured = defineString("EMAIL_PROVIDER_CONFIGURED", { default: "false" });

const smartCutHmacSecret = defineSecret("SMARTCUT_HMAC_SECRET");
const claimTokenEncryptionKey = defineSecret("CLAIM_TOKEN_ENCRYPTION_KEY");
const deliveryCodeSecret = defineSecret("DELIVERY_CODE_SECRET");
const trackingRateLimitSecret = defineSecret("TRACKING_RATE_LIMIT_SECRET");
const cronSecret = defineSecret("CRON_SECRET");

const apiSecrets = [
  smartCutHmacSecret,
  claimTokenEncryptionKey,
  deliveryCodeSecret,
  trackingRateLimitSecret,
  cronSecret,
];

function loadNonSecretConfiguration() {
  process.env.LEGAL_CONTENT_APPROVED = legalApproved.value();
  process.env.OPERATIONS_READY = operationsReady.value();
  process.env.HAIPAC_PUBLIC_URL = publicUrl.value();
  process.env.EMAIL_FROM = emailFrom.value();
  process.env.EMAIL_PROVIDER_CONFIGURED = emailProviderConfigured.value();
}

export const api = onRequest(
  {
    region: functionRegion,
    serviceAccount: runtimeServiceAccount,
    timeoutSeconds: 60,
    memory: "512MiB",
    maxInstances: 10,
    secrets: apiSecrets,
  },
  async (req, res) => {
    loadNonSecretConfiguration();
    const headers = new Headers();
    for (const [name, value] of Object.entries(req.headers)) {
      if (name.toLowerCase() === "host" || name.toLowerCase() === "content-length") continue;
      if (typeof value === "string") headers.set(name, value);
      else if (Array.isArray(value)) headers.set(name, value.join(", "));
    }

    const rawBody = (req as typeof req & { rawBody?: Buffer }).rawBody;
    const methodAllowsBody = !["GET", "HEAD"].includes(req.method);
    const body = methodAllowsBody
      ? rawBody
        ? new TextDecoder().decode(rawBody)
        : req.body === undefined
          ? undefined
          : JSON.stringify(req.body)
      : undefined;

    try {
      const originalUrl = req.originalUrl ?? req.url;
      const request = new Request(`https://${req.get("host") ?? "localhost"}${originalUrl}`, {
        method: req.method,
        headers,
        ...(body ? { body } : {}),
      });
      const forwardedFor = req.headers["x-forwarded-for"];
      const clientIp = Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor;
      const response = await handleApiRequest(request, clientIp?.split(",")[0]?.trim());
      const responseBody = Buffer.from(await response.arrayBuffer());
      res.status(response.status);
      response.headers.forEach((value, name) => res.set(name, value));
      res.send(responseBody);
    } catch {
      res.status(500).set("Content-Type", "application/json; charset=utf-8").set("Cache-Control", "no-store");
      res.send(JSON.stringify({ error: "INTERNAL_ERROR" }));
    }
  },
);
