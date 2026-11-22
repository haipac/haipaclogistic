import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { ApiError } from "@/lib/firebase/auth";
import { getFirebaseAdminDb } from "@/lib/firebase/admin";

const CLOCK_SKEW_SECONDS = 5 * 60;

export async function verifySmartCutRequest(request: Request, rawBody: string) {
  const secret = process.env.SMARTCUT_HMAC_SECRET;
  if (!secret || Buffer.byteLength(secret) < 32) throw new ApiError(503, "INTEGRATION_NOT_CONFIGURED");

  const timestamp = request.headers.get("x-haipac-timestamp") ?? "";
  const nonce = request.headers.get("x-haipac-nonce") ?? "";
  const receivedSignature = (request.headers.get("x-haipac-signature") ?? "").toLowerCase();
  if (!/^\d{10}$/.test(timestamp) || !/^[a-zA-Z0-9_-]{16,100}$/.test(nonce) || !/^[a-f0-9]{64}$/.test(receivedSignature)) {
    throw new ApiError(401, "SIGNATURE_INVALID");
  }

  const timestampNumber = Number(timestamp);
  if (Math.abs(Math.floor(Date.now() / 1000) - timestampNumber) > CLOCK_SKEW_SECONDS) {
    throw new ApiError(401, "SIGNATURE_EXPIRED");
  }

  const bodyHash = createHash("sha256").update(rawBody, "utf8").digest("hex");
  const canonical = ["v1", request.method.toUpperCase(), new URL(request.url).pathname, timestamp, nonce, bodyHash].join("\n");
  const expected = createHmac("sha256", secret).update(canonical, "utf8").digest();
  const supplied = Buffer.from(receivedSignature, "hex");
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) {
    throw new ApiError(401, "SIGNATURE_INVALID");
  }

  const nonceId = createHash("sha256").update(nonce).digest("hex");
  const nonceRef = getFirebaseAdminDb().collection("integrationNonces").doc(nonceId);
  const expiresAt = Timestamp.fromMillis(Date.now() + CLOCK_SKEW_SECONDS * 2 * 1000);
  try {
    await nonceRef.create({ expiresAt, createdAt: FieldValue.serverTimestamp() });
  } catch (error) {
    const code = typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
    if (code === 6 || code === "already-exists") throw new ApiError(409, "NONCE_ALREADY_USED");
    throw error;
  }

  return { bodyHash };
}

export function getIdempotencyKey(request: Request) {
  const key = request.headers.get("idempotency-key") ?? "";
  if (!/^[a-zA-Z0-9._:-]{8,120}$/.test(key)) throw new ApiError(400, "IDEMPOTENCY_KEY_REQUIRED");
  return key;
}
