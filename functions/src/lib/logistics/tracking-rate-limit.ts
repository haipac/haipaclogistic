import { createHmac } from "node:crypto";
import { Timestamp } from "firebase-admin/firestore";
import { ApiError } from "@/lib/firebase/auth";
import { getFirebaseAdminDb } from "@/lib/firebase/admin";

const WINDOW_MS = 60_000;
const MAX_LOOKUPS_PER_WINDOW = 20;

export async function enforceTrackingRateLimit(request: Request) {
  const secret = process.env.TRACKING_RATE_LIMIT_SECRET;
  if (!secret || Buffer.byteLength(secret) < 32) throw new ApiError(503, "TRACKING_PROTECTION_NOT_CONFIGURED");
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  if (!forwarded || forwarded.length > 100) throw new ApiError(503, "TRACKING_PROTECTION_NOT_CONFIGURED");

  const window = Math.floor(Date.now() / WINDOW_MS);
  const key = createHmac("sha256", secret).update(`${forwarded}:${window}`).digest("hex");
  const ref = getFirebaseAdminDb().collection("trackingRateLimits").doc(key);
  await getFirebaseAdminDb().runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    const count = Number(snapshot.get("count") ?? 0);
    if (count >= MAX_LOOKUPS_PER_WINDOW) throw new ApiError(429, "TRACKING_RATE_LIMITED");
    transaction.set(ref, {
      count: count + 1,
      expiresAt: Timestamp.fromMillis((window + 2) * WINDOW_MS),
    });
  });
}
