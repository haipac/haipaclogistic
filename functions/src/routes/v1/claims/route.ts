import { FieldValue, type DocumentReference } from "firebase-admin/firestore";
import { z } from "zod";
import { getFirebaseAdminDb } from "@/lib/firebase/admin";
import { requireUser, ApiError } from "@/lib/firebase/auth";
import { ensureAccount } from "@/lib/account/profiles";
import { apiFailure, jsonOk, readJson } from "@/lib/api/http";
import { sha256 } from "@/lib/security/secrets";


const ClaimSchema = z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{40,60}$/) }).strict();

export async function POST(request: Request) {
  try {
    const user = await requireUser(request);
    if (!user.email) throw new ApiError(403, "EMAIL_REQUIRED");
    await ensureAccount(user.uid, user.email);
    const parsed = ClaimSchema.safeParse(await readJson(request, 4 * 1024));
    if (!parsed.success) throw new ApiError(400, "CLAIM_TOKEN_INVALID");
    const db = getFirebaseAdminDb();
    const tokenRef = db.collection("claimTokens").doc(sha256(parsed.data.token));
    const userRef = db.collection("users").doc(user.uid);

    const trackingNumber = await db.runTransaction(async (transaction) => {
      const tokenSnapshot = await transaction.get(tokenRef);
      if (!tokenSnapshot.exists) throw new ApiError(404, "CLAIM_TOKEN_INVALID_OR_USED");
      const expiresAt = tokenSnapshot.get("expiresAt")?.toDate?.().getTime?.() ?? 0;
      if (expiresAt <= Date.now()) throw new ApiError(410, "CLAIM_TOKEN_EXPIRED");
      const expectedEmail = String(tokenSnapshot.get("recipientEmail") ?? "").toLowerCase();
      if (expectedEmail !== user.email!.toLowerCase()) throw new ApiError(403, "CLAIM_EMAIL_MISMATCH");
      const shipmentId = String(tokenSnapshot.get("shipmentId") ?? "");
      if (!/^[0-9a-f-]{36}$/i.test(shipmentId)) throw new ApiError(503, "CLAIM_DATA_INVALID");
      const shipmentRef: DocumentReference = db.collection("shipments").doc(shipmentId);
      const [shipmentSnapshot, userSnapshot] = await Promise.all([transaction.get(shipmentRef), transaction.get(userRef)]);
      if (!shipmentSnapshot.exists) throw new ApiError(404, "SHIPMENT_NOT_FOUND");
      const alreadyClaimedBy = shipmentSnapshot.get("recipientUid");
      if (alreadyClaimedBy && alreadyClaimedBy !== user.uid) throw new ApiError(409, "SHIPMENT_ALREADY_CLAIMED");
      const currentCase = userSnapshot.get("caseNumber");
      if (typeof currentCase !== "string") throw new ApiError(503, "ACCOUNT_NOT_READY");
      transaction.update(shipmentRef, {
        recipientUid: user.uid,
        recipientCaseNumber: currentCase,
        claimedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      transaction.delete(tokenRef);
      return String(shipmentSnapshot.get("trackingNumber"));
    });
    return jsonOk({ claimed: true, trackingNumber });
  } catch (error) {
    return apiFailure(error);
  }
}
