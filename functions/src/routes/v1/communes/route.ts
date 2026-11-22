import { getFirebaseAdminDb } from "@/lib/firebase/admin";
import { apiFailure, jsonOk } from "@/lib/api/http";


export async function GET() {
  try {
    const snapshot = await getFirebaseAdminDb().collection("communes")
      .where("active", "==", true)
      .limit(500)
      .get();
    const communes = snapshot.docs
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
    return jsonOk({ communes });
  } catch (error) {
    return apiFailure(error);
  }
}
