import { getFirebaseAdminDb } from "@/lib/firebase/admin";
import { apiFailure, jsonOk } from "@/lib/api/http";
import { getRateCardEffectiveDateError, RateCardSchema } from "@/lib/logistics/rates";

export async function GET() {
  try {
    const db = getFirebaseAdminDb();
    const settingsSnapshot = await db.collection("settings").doc("rates").get();
    const activeVersion = settingsSnapshot.get("activeVersion");
    if (typeof activeVersion !== "string" || !/^[a-zA-Z0-9._-]{1,50}$/.test(activeVersion)) {
      return jsonOk({ published: false, reason: "RATE_CARD_NOT_ACTIVE" });
    }

    const cardSnapshot = await db.collection("rateCards").doc(activeVersion).get();
    if (!cardSnapshot.exists) return jsonOk({ published: false, reason: "RATE_CARD_NOT_ACTIVE" });

    const stored = cardSnapshot.data() ?? {};
    const parsed = RateCardSchema.safeParse({
      version: stored.version,
      status: stored.status,
      effectiveFrom: stored.effectiveFrom,
      effectiveUntil: stored.effectiveUntil,
      currency: stored.currency,
      tierBasis: stored.tierBasis,
      volumetricDivisor: stored.volumetricDivisor,
      minimumBillableKg: stored.minimumBillableKg,
      maxAutoQuoteKg: stored.maxAutoQuoteKg,
      zones: stored.zones,
    });
    if (!parsed.success || parsed.data.status !== "active" || parsed.data.version !== activeVersion) {
      return jsonOk({ published: false, reason: "RATE_CARD_INVALID" });
    }

    const dateError = getRateCardEffectiveDateError(parsed.data);
    if (dateError) return jsonOk({ published: false, reason: dateError });

    const communeSnapshot = await db.collection("communes")
      .where("active", "==", true)
      .limit(500)
      .get();
    const communes = communeSnapshot.docs
      .map((document) => {
        const data = document.data();
        if (
          typeof data.name !== "string" ||
          typeof data.departmentName !== "string" ||
          typeof data.departmentCode !== "string"
        ) return null;
        return {
          code: document.id,
          name: data.name,
          departmentName: data.departmentName,
          departmentCode: data.departmentCode,
        };
      })
      .filter((commune): commune is NonNullable<typeof commune> => commune !== null)
      .sort((left, right) => left.departmentName.localeCompare(right.departmentName, "fr") || left.name.localeCompare(right.name, "fr"));

    const { data: rateCard } = parsed;
    return jsonOk({
      published: true,
      rateCard: {
        version: rateCard.version,
        effectiveFrom: rateCard.effectiveFrom,
        effectiveUntil: rateCard.effectiveUntil,
        currency: rateCard.currency,
        tierBasis: rateCard.tierBasis,
        volumetricDivisor: rateCard.volumetricDivisor,
        minimumBillableKg: rateCard.minimumBillableKg,
        zones: rateCard.zones,
      },
      communes,
    });
  } catch (error) {
    return apiFailure(error);
  }
}
