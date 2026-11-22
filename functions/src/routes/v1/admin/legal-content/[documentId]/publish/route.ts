import { FieldValue } from "firebase-admin/firestore";
import { ApiError, requireAdmin } from "@/lib/firebase/auth";
import { apiFailure, jsonOk, readJson } from "@/lib/api/http";
import { getFirebaseAdminDb } from "@/lib/firebase/admin";
import { isLegalDocumentId, LegalDocumentDraftSchema } from "@/lib/legal-content";

export async function POST(request: Request, context: { params: Promise<{ documentId: string }> }) {
  try {
    const admin = await requireAdmin(request);
    const { documentId } = await context.params;
    if (!isLegalDocumentId(documentId)) return jsonOk({ error: "LEGAL_DOCUMENT_NOT_FOUND" }, 404);
    const confirmation = await readJson(request, 4 * 1024);
    if (!confirmation || typeof confirmation !== "object" || (confirmation as { confirm?: unknown }).confirm !== true) {
      return jsonOk({ error: "LEGAL_PUBLICATION_CONFIRMATION_REQUIRED" }, 400);
    }

    const db = getFirebaseAdminDb();
    const documentRef = db.collection("legalDocuments").doc(documentId);
    const auditRef = db.collection("adminAuditLog").doc();
    const publishedVersion = await db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(documentRef);
      const existing = snapshot.get("draft") as unknown;
      const draft = LegalDocumentDraftSchema.safeParse(existing);
      if (!draft.success) throw new ApiError(409, "LEGAL_DRAFT_REQUIRED");
      const published = snapshot.get("published") as { title?: unknown; body?: unknown } | undefined;
      if (published?.title === draft.data.title && published.body === draft.data.body) {
        throw new ApiError(409, "LEGAL_CONTENT_UNCHANGED");
      }

      const currentVersion = snapshot.get("published.version");
      const nextVersion = (typeof currentVersion === "number" && Number.isSafeInteger(currentVersion) && currentVersion > 0 ? currentVersion : 0) + 1;
      const versionRef = documentRef.collection("versions").doc(String(nextVersion));
      const publication = {
        ...draft.data,
        version: nextVersion,
        publishedAt: FieldValue.serverTimestamp(),
        publishedBy: admin.uid,
      };
      transaction.create(versionRef, publication);
      transaction.set(documentRef, { published: publication }, { merge: true });
      transaction.create(auditRef, {
        actorUid: admin.uid,
        action: "legal_content_published",
        targetId: documentId,
        version: nextVersion,
        createdAt: FieldValue.serverTimestamp(),
      });
      return nextVersion;
    });

    return jsonOk({ documentId, version: publishedVersion });
  } catch (error) {
    return apiFailure(error);
  }
}
