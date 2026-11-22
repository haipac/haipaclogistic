import { FieldValue } from "firebase-admin/firestore";
import { getFirebaseAdminDb } from "@/lib/firebase/admin";
import { ApiError, requireAdmin } from "@/lib/firebase/auth";
import { apiFailure, jsonOk } from "@/lib/api/http";
import { getRateCardEffectiveDateError, RateCardSchema } from "@/lib/logistics/rates";


export async function POST(request: Request, context: { params: Promise<{ version: string }> }) {
  try {
    const admin = await requireAdmin(request);
    const { version } = await context.params;
    if (!/^[a-zA-Z0-9._-]{1,50}$/.test(version)) return jsonOk({ error: "RATE_VERSION_INVALID" }, 400);
    const db = getFirebaseAdminDb();
    const cardRef = db.collection("rateCards").doc(version);
    const settingsRef = db.collection("settings").doc("rates");
    const auditRef = db.collection("adminAuditLog").doc();
    await db.runTransaction(async (transaction) => {
      const [cardSnapshot, settingsSnapshot] = await Promise.all([transaction.get(cardRef), transaction.get(settingsRef)]);
      if (!cardSnapshot.exists) throw new ApiError(404, "RATE_CARD_NOT_FOUND");
      const storedCard = cardSnapshot.data()!;
      const activeCard = {
        version: storedCard.version,
        status: "active",
        effectiveFrom: storedCard.effectiveFrom,
        effectiveUntil: storedCard.effectiveUntil,
        currency: storedCard.currency,
        tierBasis: storedCard.tierBasis,
        volumetricDivisor: storedCard.volumetricDivisor,
        minimumBillableKg: storedCard.minimumBillableKg,
        maxAutoQuoteKg: storedCard.maxAutoQuoteKg,
        zones: storedCard.zones,
      };
      const validated = RateCardSchema.safeParse(activeCard);
      if (!validated.success) throw new ApiError(422, "RATE_CARD_INCOMPLETE");
      const effectiveDateError = getRateCardEffectiveDateError(validated.data);
      if (effectiveDateError) throw new ApiError(422, effectiveDateError);

      const previousVersion = settingsSnapshot.get("activeVersion");
      if (typeof previousVersion === "string" && previousVersion !== version) {
        transaction.update(db.collection("rateCards").doc(previousVersion), { status: "retired", retiredAt: FieldValue.serverTimestamp() });
      }
      transaction.update(cardRef, { status: "active", activatedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(), updatedBy: admin.uid });
      transaction.set(settingsRef, { activeVersion: version, updatedAt: FieldValue.serverTimestamp(), updatedBy: admin.uid }, { merge: true });
      transaction.create(auditRef, { actorUid: admin.uid, action: "rate_card_activated", targetId: version, createdAt: FieldValue.serverTimestamp() });
    });
    return jsonOk({ version, status: "active" });
  } catch (error) {
    return apiFailure(error);
  }
}
