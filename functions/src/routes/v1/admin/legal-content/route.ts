import { getFirebaseAdminDb } from "@/lib/firebase/admin";
import { apiFailure, jsonOk } from "@/lib/api/http";
import { requireAdmin } from "@/lib/firebase/auth";
import { LEGAL_DOCUMENT_IDS, serializeLegalDocument } from "@/lib/legal-content";

export async function GET(request: Request) {
  try {
    await requireAdmin(request);
    const db = getFirebaseAdminDb();
    const snapshots = await Promise.all(
      LEGAL_DOCUMENT_IDS.map((documentId) => db.collection("legalDocuments").doc(documentId).get()),
    );
    const documents = Object.fromEntries(snapshots.map((snapshot, index) => [
      LEGAL_DOCUMENT_IDS[index],
      snapshot.exists ? serializeLegalDocument(snapshot.data() ?? {}) : { draft: null, published: null },
    ]));
    return jsonOk({ documents });
  } catch (error) {
    return apiFailure(error);
  }
}
