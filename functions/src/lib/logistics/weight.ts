export type ParcelMeasurements = {
  lengthCm: number;
  widthCm: number;
  heightCm: number;
  realWeightKg: number;
};

export type BillableWeight = ParcelMeasurements & {
  volumetricWeightKg: number;
  rawBillableWeightKg: number;
  roundedBillableWeightKg: number;
};

function finitePositive(value: number, name: string, max: number) {
  if (!Number.isFinite(value) || value <= 0 || value > max) {
    throw new Error("INVALID_" + name.toUpperCase());
  }
  return value;
}

function toPrecision(value: number, digits: number) {
  return Number(value.toFixed(digits));
}

export function calculateBillableWeight(parcel: ParcelMeasurements): BillableWeight {
  const lengthCm = finitePositive(parcel.lengthCm, "length_cm", 500);
  const widthCm = finitePositive(parcel.widthCm, "width_cm", 500);
  const heightCm = finitePositive(parcel.heightCm, "height_cm", 500);
  const realWeightKg = finitePositive(parcel.realWeightKg, "real_weight_kg", 1000);

  const volumetricWeightKg = toPrecision((lengthCm * widthCm * heightCm) / 6000, 6);
  const rawBillableWeightKg = Math.max(1, realWeightKg, volumetricWeightKg);

  // The owner approved rounding every fractional billable kilogram upward.
  const roundedBillableWeightKg = Math.ceil(rawBillableWeightKg);

  return {
    lengthCm,
    widthCm,
    heightCm,
    realWeightKg,
    volumetricWeightKg,
    rawBillableWeightKg: toPrecision(rawBillableWeightKg, 6),
    roundedBillableWeightKg,
  };
}
