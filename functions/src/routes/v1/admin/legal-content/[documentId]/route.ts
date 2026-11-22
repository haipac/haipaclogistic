import { FieldValue } from "firebase-admin/firestore";
import { getFirebaseAdminDb } from "@/lib/firebase/admin";
import { apiFailure, jsonOk, readJson } from "@/lib/api/http";
import { requireAdmin } from "@/lib/firebase/auth";
import { isLegalDocumentId, LegalDocumentDraftSchema } from "@/lib/legal-content";

export async function PUT(request: Request, context: { params: Promise<{ documentId: string }> }) {
  try {
    const admin = await requireAdmin(request);
    const { documentId } = await context.params;
    if (!isLegalDocumentId(documentId)) return jsonOk({ error: "LEGAL_DOCUMENT_NOT_FOUND" }, 404);
    const parsed = LegalDocumentDraftSchema.safeParse(await readJson(request, 48 * 1024));
    if (!parsed.success) return jsonOk({ error: "LEGAL_DOCUMENT_INVALID" }, 400);

    const db = getFirebaseAdminDb();
    const documentRef = db.collection("legalDocuments").doc(documentId);
    const auditRef = db.collection("adminAuditLog").doc();
    await db.runTransaction(async (transaction) => {
      transaction.set(documentRef, {
        draft: {
          ...parsed.data,
          updatedAt: FieldValue.serverTimestamp(),
          updatedBy: admin.uid,
        },
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: admin.uid,
      }, { merge: true });
      transaction.create(auditRef, {
        actorUid: admin.uid,
        action: "legal_content_draft_saved",
        targetId: documentId,
        createdAt: FieldValue.serverTimestamp(),
      });
    });
    return jsonOk({ documentId, status: "draft_saved" });
  } catch (error) {
    return apiFailure(error);
  }
}
