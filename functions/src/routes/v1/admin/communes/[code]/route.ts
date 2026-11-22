import { FieldValue } from "firebase-admin/firestore";
import { z } from "zod";
import { getFirebaseAdminDb } from "@/lib/firebase/admin";
import { requireAdmin } from "@/lib/firebase/auth";
import { apiFailure, jsonOk, readJson } from "@/lib/api/http";
import { getCommuneCode, getDepartmentCode } from "@/lib/logistics/commune-code";


const CommuneSchema = z.object({
  name: z.string().trim().min(2).max(100),
  departmentCode: z.string().trim().toUpperCase().regex(/^[A-Z0-9_-]{2,16}$/),
  departmentName: z.string().trim().min(2).max(100),
  active: z.boolean(),
}).strict();

export async function PUT(request: Request, context: { params: Promise<{ code: string }> }) {
  try {
    const admin = await requireAdmin(request);
    const { code: rawCode } = await context.params;
    const code = rawCode.trim().toUpperCase();
    if (!/^[A-Z0-9_-]{2,40}$/.test(code)) return jsonOk({ error: "COMMUNE_CODE_INVALID" }, 400);
    const parsed = CommuneSchema.safeParse(await readJson(request, 8 * 1024));
    if (!parsed.success) return jsonOk({ error: "COMMUNE_INVALID" }, 400);
    if (
      getCommuneCode(parsed.data.departmentName, parsed.data.name) !== code ||
      getDepartmentCode(parsed.data.departmentName) !== parsed.data.departmentCode
    ) return jsonOk({ error: "COMMUNE_CODE_MISMATCH" }, 400);
    const db = getFirebaseAdminDb();
    const communeRef = db.collection("communes").doc(code);
    const auditRef = db.collection("adminAuditLog").doc();
    await db.runTransaction(async (transaction) => {
      const existing = await transaction.get(communeRef);
      transaction.set(communeRef, {
        ...parsed.data, updatedAt: FieldValue.serverTimestamp(), updatedBy: admin.uid,
      }, { merge: true });
      transaction.create(auditRef, {
        actorUid: admin.uid,
        action: parsed.data.active ? "commune_activated_or_updated" : "commune_deactivated",
        targetId: code,
        from: existing.exists ? { name: existing.get("name"), departmentCode: existing.get("departmentCode"), active: existing.get("active") } : null,
        to: { name: parsed.data.name, departmentCode: parsed.data.departmentCode, active: parsed.data.active },
        createdAt: FieldValue.serverTimestamp(),
      });
    });
    return jsonOk({ code, active: parsed.data.active });
  } catch (error) {
    return apiFailure(error);
  }
}
