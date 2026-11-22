const DEPARTMENT_CODES: Record<string, string> = {
  artibonite: "AR",
  centre: "CE",
  "grand anse": "GA",
  nippes: "NI",
  nord: "NO",
  "nord est": "NE",
  "nord ouest": "NW",
  ouest: "OU",
  sud: "SU",
  "sud est": "SE",
};

function normalizeDepartment(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export function getDepartmentCode(value: string) {
  return DEPARTMENT_CODES[normalizeDepartment(value)] ?? "";
}

export function getCommuneCode(departmentName: string, communeName: string) {
  const departmentCode = getDepartmentCode(departmentName);
  const communeSlug = communeName.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return departmentCode && communeSlug ? `${departmentCode}-${communeSlug}` : "";
}
