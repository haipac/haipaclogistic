import { FieldValue } from "firebase-admin/firestore";
import { z } from "zod";
import { getFirebaseAdminDb } from "@/lib/firebase/admin";
import { ApiError, requireAdmin } from "@/lib/firebase/auth";
import { apiFailure, jsonOk, readJson } from "@/lib/api/http";


const OriginSchema = z.object({ communeCode: z.string().trim().toUpperCase().regex(/^[A-Z0-9_-]{2,40}$/) }).strict();

export async function GET(request: Request) {
  try {
    await requireAdmin(request);
    const snapshot = await getFirebaseAdminDb().collection("settings").doc("dispatch").get();
    return jsonOk({ originCommuneCode: snapshot.get("originCommuneCode") ?? null });
  } catch (error) { return apiFailure(error); }
}

export async function PUT(request: Request) {
  try {
    const admin = await requireAdmin(request);
    const parsed = OriginSchema.safeParse(await readJson(request, 4 * 1024));
    if (!parsed.success) return jsonOk({ error: "DISPATCH_ORIGIN_INVALID" }, 400);
    const db = getFirebaseAdminDb();
    const settingsRef = db.collection("settings").doc("dispatch");
    const communeRef = db.collection("communes").doc(parsed.data.communeCode);
    const auditRef = db.collection("adminAuditLog").doc();
    await db.runTransaction(async (transaction) => {
      const [commune, settings] = await Promise.all([transaction.get(communeRef), transaction.get(settingsRef)]);
      if (!commune.exists || commune.get("active") !== true) throw new ApiError(422, "COMMUNE_NOT_COVERED");
      const previousCode = settings.get("originCommuneCode") ?? null;
      transaction.set(settingsRef, {
        originCommuneCode: parsed.data.communeCode, updatedAt: FieldValue.serverTimestamp(), updatedBy: admin.uid,
      }, { merge: true });
      transaction.create(auditRef, {
        actorUid: admin.uid, action: "dispatch_origin_changed", targetId: parsed.data.communeCode,
        from: previousCode, to: parsed.data.communeCode, createdAt: FieldValue.serverTimestamp(),
      });
    });
    return jsonOk({ originCommuneCode: parsed.data.communeCode });
  } catch (error) { return apiFailure(error); }
}
