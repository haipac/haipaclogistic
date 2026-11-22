import { getFirebaseAdminDb } from "@/lib/firebase/admin";
import { apiFailure, jsonOk } from "@/lib/api/http";
import { isLegalDocumentId, serializeLegalDocument } from "@/lib/legal-content";

export async function GET(_request: Request, context: { params: Promise<{ documentId: string }> }) {
  try {
    const { documentId } = await context.params;
    if (!isLegalDocumentId(documentId)) return jsonOk({ error: "LEGAL_DOCUMENT_NOT_FOUND" }, 404);
    const snapshot = await getFirebaseAdminDb().collection("legalDocuments").doc(documentId).get();
    const published = snapshot.exists
      ? serializeLegalDocument(snapshot.data() ?? {}).published
      : null;
    return jsonOk({ document: published ? { ...published, id: documentId } : null });
  } catch (error) {
    return apiFailure(error);
  }
}
