import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { ApiError } from "@/lib/firebase/auth";

function encryptionKey() {
  const encoded = process.env.CLAIM_TOKEN_ENCRYPTION_KEY ?? "";
  const key = Buffer.from(encoded, "base64");
  if (key.length !== 32) throw new ApiError(503, "CLAIM_ENCRYPTION_NOT_CONFIGURED");
  return key;
}

export function encryptPrivatePayload(value: unknown) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return {
    version: 1,
    iv: iv.toString("base64url"),
    tag: cipher.getAuthTag().toString("base64url"),
    ciphertext: ciphertext.toString("base64url"),
  };
}

export function decryptPrivatePayload<T>(payload: { version: number; iv: string; tag: string; ciphertext: string }): T {
  if (payload.version !== 1) throw new ApiError(503, "PRIVATE_PAYLOAD_VERSION_UNSUPPORTED");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(payload.iv, "base64url"));
  decipher.setAuthTag(Buffer.from(payload.tag, "base64url"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(payload.ciphertext, "base64url")),
    decipher.final(),
  ]).toString("utf8");
  return JSON.parse(plaintext) as T;
}

export function sha256(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function createOpaqueToken() {
  return randomBytes(32).toString("base64url");
}

export function hashDeliveryCode(code: string) {
  const secret = process.env.DELIVERY_CODE_SECRET;
  if (!secret || Buffer.byteLength(secret) < 32) throw new ApiError(503, "DELIVERY_CODE_NOT_CONFIGURED");
  return createHmac("sha256", secret).update(code, "utf8").digest("hex");
}

export function safeEqualHex(left: string, right: string) {
  if (!/^[a-f0-9]{64}$/i.test(left) || !/^[a-f0-9]{64}$/i.test(right)) return false;
  const leftBuffer = Buffer.from(left, "hex");
  const rightBuffer = Buffer.from(right, "hex");
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}
