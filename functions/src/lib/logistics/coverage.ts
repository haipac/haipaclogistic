import { ApiError } from "@/lib/firebase/auth";
import { getFirebaseAdminDb } from "@/lib/firebase/admin";

export type ActiveCommune = {
  code: string;
  name: string;
  departmentCode: string;
  departmentName: string;
  active: true;
};

const COMMUNE_CODE = /^[A-Z0-9_-]{2,40}$/;

export async function getActiveCommune(code: string): Promise<ActiveCommune> {
  const normalized = code.trim().toUpperCase();
  if (!COMMUNE_CODE.test(normalized)) throw new ApiError(400, "COMMUNE_INVALID");
  const snapshot = await getFirebaseAdminDb().collection("communes").doc(normalized).get();
  const value = snapshot.data();
  if (!snapshot.exists || value?.active !== true) throw new ApiError(422, "COMMUNE_NOT_COVERED");
  if (typeof value.name !== "string" || typeof value.departmentCode !== "string" || typeof value.departmentName !== "string") {
    throw new ApiError(503, "COVERAGE_CONFIGURATION_INVALID");
  }
  return {
    code: normalized,
    name: value.name,
    departmentCode: value.departmentCode,
    departmentName: value.departmentName,
    active: true,
  };
}

export function zoneBetween(origin: ActiveCommune, destination: ActiveCommune) {
  if (origin.code === destination.code) return "local" as const;
  if (origin.departmentCode === destination.departmentCode) return "regional" as const;
  return "national" as const;
}
