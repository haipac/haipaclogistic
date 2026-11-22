import { z } from "zod";
import { calculateBillableWeight, type ParcelMeasurements } from "@/lib/logistics/weight";

export const RateTierSchema = z.discriminatedUnion("method", [
  z.object({
    minBillableKg: z.number().int().min(1),
    maxBillableKg: z.number().int().min(1).nullable(),
    method: z.literal("first_kg_plus_additional"),
    firstKgHtg: z.number().int().nonnegative(),
    additionalKgHtg: z.number().int().nonnegative(),
  }).strict(),
  z.object({
    minBillableKg: z.number().int().min(1),
    maxBillableKg: z.number().int().min(1).nullable(),
    method: z.literal("per_kg"),
    pricePerKgHtg: z.number().int().nonnegative(),
  }).strict(),
]);

export const MAX_RATE_TIERS_PER_ZONE = 500;
const ZoneTiersSchema = z.array(RateTierSchema).min(1).max(MAX_RATE_TIERS_PER_ZONE);
const ZoneTableSchema = z.object({
  local: ZoneTiersSchema,
  regional: ZoneTiersSchema,
  national: ZoneTiersSchema,
}).strict();

const LocalDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}, "RATE_DATE_INVALID");

function tiersCoverConfiguredRange(
  zones: z.infer<typeof ZoneTableSchema>,
  maxAutoQuoteKg: number,
) {
  return Object.values(zones).every((tiers) => {
    const ordered = [...tiers].sort((left, right) => left.minBillableKg - right.minBillableKg);
    if (ordered[0]?.minBillableKg !== 1) return false;

    for (let index = 0; index < ordered.length; index += 1) {
      const tier = ordered[index];
      const next = ordered[index + 1];
      if (tier.maxBillableKg !== null && tier.maxBillableKg < tier.minBillableKg) return false;
      if (tier.maxBillableKg === null && next) return false;
      if (tier.maxBillableKg !== null && next && next.minBillableKg !== tier.maxBillableKg + 1) return false;
    }

    const finalTier = ordered.at(-1);
    return Boolean(
      finalTier &&
      (finalTier.maxBillableKg === null || finalTier.maxBillableKg >= maxAutoQuoteKg) &&
      ordered.some((tier) => tier.minBillableKg <= maxAutoQuoteKg &&
        (tier.maxBillableKg === null || tier.maxBillableKg >= maxAutoQuoteKg)),
    );
  });
}

export const RateCardSchema = z.object({
  version: z.string().min(1).max(50),
  status: z.enum(["draft", "active", "retired"]),
  effectiveFrom: LocalDateSchema,
  effectiveUntil: LocalDateSchema.nullable(),
  currency: z.literal("HTG"),
  tierBasis: z.literal("rounded_billable_kg"),
  volumetricDivisor: z.literal(6000),
  minimumBillableKg: z.literal(1),
  maxAutoQuoteKg: z.number().int().min(1).max(1000),
  zones: ZoneTableSchema,
  updatedAt: z.unknown().optional(),
  updatedBy: z.string().optional(),
  activatedAt: z.unknown().optional(),
  retiredAt: z.unknown().optional(),
}).strict().superRefine((card, context) => {
  if (card.effectiveUntil && card.effectiveUntil < card.effectiveFrom) {
    context.addIssue({
      code: "custom",
      path: ["effectiveUntil"],
      message: "RATE_END_BEFORE_START",
    });
  }
  if (card.status === "active" && !tiersCoverConfiguredRange(card.zones, card.maxAutoQuoteKg)) {
    context.addIssue({
      code: "custom",
      path: ["zones"],
      message: "ACTIVE_RATE_CARD_MUST_COVER_EVERY_ZONE_WITHOUT_GAPS",
    });
  }
});

export type RateCard = z.infer<typeof RateCardSchema>;

export function getHaipacBusinessDate(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Port-au-Prince",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function getRateCardEffectiveDateError(
  card: Pick<RateCard, "effectiveFrom" | "effectiveUntil">,
  businessDate = getHaipacBusinessDate(),
) {
  if (businessDate < card.effectiveFrom) return "RATE_CARD_NOT_YET_EFFECTIVE";
  if (card.effectiveUntil && businessDate > card.effectiveUntil) return "RATE_CARD_EXPIRED";
  return null;
}

export type QuoteParcel = ParcelMeasurements & {
  packageRef: string;
};

export type ParcelQuote = {
  packageRef: string;
  weight: ReturnType<typeof calculateBillableWeight>;
  zoneId: string;
  tierMethod: "first_kg_plus_additional" | "per_kg";
  amountHtg: number;
};

export class QuoteUnavailableError extends Error {
  constructor(public readonly code: string) {
    super(code);
  }
}

function findTier(tiers: RateCard["zones"]["local"], billableKg: number) {
  return tiers.find(
    (tier) =>
      billableKg >= tier.minBillableKg &&
      (tier.maxBillableKg === null || billableKg <= tier.maxBillableKg),
  );
}

function priceParcel(tier: z.infer<typeof RateTierSchema>, billableKg: number) {
  if (tier.method === "first_kg_plus_additional") {
    return tier.firstKgHtg + Math.max(0, billableKg - 1) * tier.additionalKgHtg;
  }
  return billableKg * tier.pricePerKgHtg;
}

export function quoteParcels(
  rateCardInput: unknown,
  parcels: QuoteParcel[],
  zoneId: string,
  businessDate = getHaipacBusinessDate(),
): { parcels: ParcelQuote[]; totalHtg: number; rateVersion: string } {
  const parsed = RateCardSchema.safeParse(rateCardInput);
  if (!parsed.success || parsed.data.status !== "active") {
    throw new QuoteUnavailableError("RATE_CARD_NOT_ACTIVE");
  }

  const card = parsed.data;
  const dateError = getRateCardEffectiveDateError(card, businessDate);
  if (dateError) throw new QuoteUnavailableError(dateError);
  const zoneTiers = card.zones[zoneId as keyof RateCard["zones"]];
  if (!zoneTiers) throw new QuoteUnavailableError("ZONE_RATE_NOT_CONFIGURED");

  const parcelQuotes = parcels.map((parcel) => {
    const weight = calculateBillableWeight(parcel);
    if (weight.roundedBillableWeightKg > card.maxAutoQuoteKg) {
      throw new QuoteUnavailableError("MANUAL_QUOTE_REQUIRED");
    }
    const tier = findTier(zoneTiers, weight.roundedBillableWeightKg);
    if (!tier) throw new QuoteUnavailableError("MANUAL_QUOTE_REQUIRED");
    return {
      packageRef: parcel.packageRef,
      weight,
      zoneId,
      tierMethod: tier.method,
      amountHtg: priceParcel(tier, weight.roundedBillableWeightKg),
    };
  });

  const totalHtg = parcelQuotes.reduce((total, parcel) => total + parcel.amountHtg, 0);
  if (!Number.isSafeInteger(totalHtg)) {
    throw new QuoteUnavailableError("QUOTE_AMOUNT_INVALID");
  }

  return { parcels: parcelQuotes, totalHtg, rateVersion: card.version };
}
