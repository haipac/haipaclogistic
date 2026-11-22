import { FieldValue } from "firebase-admin/firestore";
import { getFirebaseAdminDb } from "@/lib/firebase/admin";
import { ApiError, requireAdmin } from "@/lib/firebase/auth";
import { apiFailure, jsonOk, readJson } from "@/lib/api/http";
import { RateCardSchema } from "@/lib/logistics/rates";


export async function PUT(request: Request, context: { params: Promise<{ version: string }> }) {
  try {
    const admin = await requireAdmin(request);
    const { version } = await context.params;
    if (!/^[a-zA-Z0-9._-]{1,50}$/.test(version)) return jsonOk({ error: "RATE_VERSION_INVALID" }, 400);
    const input = await readJson(request, 64 * 1024);
    const parsed = RateCardSchema.safeParse(input);
    if (!parsed.success || parsed.data.status !== "draft" || parsed.data.version !== version) {
      return jsonOk({ error: "RATE_CARD_INVALID" }, 400);
    }
    const db = getFirebaseAdminDb();
    const settingsRef = db.collection("settings").doc("rates");
    const cardRef = db.collection("rateCards").doc(version);
    const auditRef = db.collection("adminAuditLog").doc();
    await db.runTransaction(async (transaction) => {
      const settings = await transaction.get(settingsRef);
      if (settings.get("activeVersion") === version) throw new ApiError(409, "CREATE_NEW_VERSION_TO_CHANGE_ACTIVE_RATE");
      transaction.set(cardRef, {
        ...parsed.data,
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: admin.uid,
      }, { merge: false });
      transaction.create(auditRef, {
        actorUid: admin.uid, action: "rate_card_saved", targetId: version, createdAt: FieldValue.serverTimestamp(),
      });
    });
    return jsonOk({ version, status: "draft" });
  } catch (error) {
    return apiFailure(error);
  }
}
