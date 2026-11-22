import assert from "node:assert/strict";
import test from "node:test";
import { getHaipacBusinessDate, quoteParcels, RateCardSchema, type RateCard } from "@/lib/logistics/rates";
import { calculateBillableWeight } from "@/lib/logistics/weight";

// Synthetic amounts exercise the calculation only; they are not HAIPAC prices.
const fixtureRateCard: RateCard = {
  version: "test-fixture",
  status: "active",
  effectiveFrom: "2026-01-01",
  effectiveUntil: null,
  currency: "HTG",
  tierBasis: "rounded_billable_kg",
  volumetricDivisor: 6000,
  minimumBillableKg: 1,
  maxAutoQuoteKg: 100,
  zones: {
    local: [
      { minBillableKg: 1, maxBillableKg: 30, method: "first_kg_plus_additional", firstKgHtg: 100, additionalKgHtg: 10 },
      { minBillableKg: 31, maxBillableKg: null, method: "per_kg", pricePerKgHtg: 7 },
    ],
    regional: [
      { minBillableKg: 1, maxBillableKg: 30, method: "first_kg_plus_additional", firstKgHtg: 200, additionalKgHtg: 20 },
      { minBillableKg: 31, maxBillableKg: null, method: "per_kg", pricePerKgHtg: 17 },
    ],
    national: [
      { minBillableKg: 1, maxBillableKg: 30, method: "first_kg_plus_additional", firstKgHtg: 300, additionalKgHtg: 30 },
      { minBillableKg: 31, maxBillableKg: null, method: "per_kg", pricePerKgHtg: 27 },
    ],
  },
};

test("billable weight rounds every fraction upward and preserves whole kilograms", () => {
  const fractional = calculateBillableWeight({ lengthCm: 10, widthCm: 10, heightCm: 10, realWeightKg: 2.1 });
  const whole = calculateBillableWeight({ lengthCm: 10, widthCm: 10, heightCm: 10, realWeightKg: 2 });

  assert.equal(fractional.roundedBillableWeightKg, 3);
  assert.equal(whole.roundedBillableWeightKg, 2);
});

test("rate validity dates use the Haiti business timezone", () => {
  assert.equal(getHaipacBusinessDate(new Date("2026-11-20T03:30:00.000Z")), "2026-11-19");
});

test("volumetric weight is compared with real weight before upward rounding", () => {
  const result = calculateBillableWeight({ lengthCm: 60, widthCm: 50, heightCm: 6, realWeightKg: 2.1 });

  assert.equal(result.volumetricWeightKg, 3);
  assert.equal(result.rawBillableWeightKg, 3);
  assert.equal(result.roundedBillableWeightKg, 3);
});

test("selects the tariff tier after rounding a parcel across the boundary", () => {
  const quote = quoteParcels(fixtureRateCard, [{
    packageRef: "boundary",
    lengthCm: 10,
    widthCm: 10,
    heightCm: 10,
    realWeightKg: 30.99,
  }], "local");

  assert.equal(quote.parcels[0].weight.roundedBillableWeightKg, 31);
  assert.equal(quote.parcels[0].tierMethod, "per_kg");
  assert.equal(quote.parcels[0].amountHtg, 217);
});

test("prices each unit parcel independently and sums the synthetic quotes", () => {
  const quote = quoteParcels(fixtureRateCard, [
    { packageRef: "one", lengthCm: 10, widthCm: 10, heightCm: 10, realWeightKg: 2.1 },
    { packageRef: "two", lengthCm: 10, widthCm: 10, heightCm: 10, realWeightKg: 30.99 },
  ], "local");

  assert.deepEqual(quote.parcels.map((parcel) => parcel.amountHtg), [120, 217]);
  assert.equal(quote.totalHtg, 337);
  assert.equal(quote.rateVersion, "test-fixture");
});

test("rejects an active tariff with a gap instead of guessing a tier", () => {
  const invalid = structuredClone(fixtureRateCard);
  invalid.zones.local[1].minBillableKg = 32;

  assert.equal(RateCardSchema.safeParse(invalid).success, false);
});

test("accepts Firestore activation metadata when validating the active card", () => {
  const storedCard = {
    ...fixtureRateCard,
    updatedAt: { seconds: 1 },
    updatedBy: "synthetic-admin",
    activatedAt: { seconds: 2 },
  };
  assert.equal(RateCardSchema.safeParse(storedCard).success, true);
});

test("supports a complete tariff with more than twelve bands above 100 kg", () => {
  const tiers: RateCard["zones"]["local"] = Array.from({ length: 12 }, (_, index) => ({
    minBillableKg: index * 10 + 1,
    maxBillableKg: (index + 1) * 10,
    method: "per_kg" as const,
    pricePerKgHtg: 10,
  }));
  tiers.push({ minBillableKg: 121, maxBillableKg: null, method: "per_kg", pricePerKgHtg: 10 });
  const rateCard = structuredClone(fixtureRateCard);
  rateCard.maxAutoQuoteKg = 150;
  rateCard.zones = { local: tiers, regional: tiers, national: tiers };

  assert.equal(RateCardSchema.safeParse(rateCard).success, true);
  assert.equal(quoteParcels(rateCard, [{
    packageRef: "heavy-synthetic",
    lengthCm: 10,
    widthCm: 10,
    heightCm: 10,
    realWeightKg: 150,
  }], "local").totalHtg, 1500);
});

test("requires a manual quote above the configured automatic weight limit", () => {
  assert.throws(
    () => quoteParcels(fixtureRateCard, [{
      packageRef: "heavy",
      lengthCm: 10,
      widthCm: 10,
      heightCm: 10,
      realWeightKg: 100.1,
    }], "local"),
    { code: "MANUAL_QUOTE_REQUIRED" },
  );
});

test("does not quote before the tariff start date", () => {
  assert.throws(
    () => quoteParcels(fixtureRateCard, [{
      packageRef: "future",
      lengthCm: 10,
      widthCm: 10,
      heightCm: 10,
      realWeightKg: 2,
    }], "local", "2025-12-31"),
    { code: "RATE_CARD_NOT_YET_EFFECTIVE" },
  );
});

test("a tariff remains valid through its inclusive end date, then fails closed", () => {
  const endingCard = { ...fixtureRateCard, effectiveUntil: "2026-11-19" };
  const parcel = [{
    packageRef: "end-date",
    lengthCm: 10,
    widthCm: 10,
    heightCm: 10,
    realWeightKg: 2,
  }];

  assert.equal(quoteParcels(endingCard, parcel, "local", "2026-11-19").totalHtg, 110);
  assert.throws(
    () => quoteParcels(endingCard, parcel, "local", "2026-11-20"),
    { code: "RATE_CARD_EXPIRED" },
  );
});

test("rejects an end date earlier than the start date", () => {
  const invalid = { ...fixtureRateCard, effectiveFrom: "2026-11-20", effectiveUntil: "2026-11-19" };
  assert.equal(RateCardSchema.safeParse(invalid).success, false);
});
