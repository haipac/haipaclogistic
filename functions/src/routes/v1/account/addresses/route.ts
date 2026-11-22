import { FieldValue } from "firebase-admin/firestore";
import { z } from "zod";
import { getFirebaseAdminDb } from "@/lib/firebase/admin";
import { ApiError, requireUser } from "@/lib/firebase/auth";
import { apiFailure, jsonOk, readJson } from "@/lib/api/http";
import { getActiveCommune } from "@/lib/logistics/coverage";


const AddressSchema = z.object({
  label: z.string().trim().min(1).max(40),
  recipientName: z.string().trim().min(2).max(100),
  phone: z.string().trim().min(7).max(32),
  department: z.string().trim().min(2).max(80),
  communeCode: z.string().trim().toUpperCase().regex(/^[A-Z0-9_-]{2,40}$/),
  locality: z.string().trim().min(2).max(120),
  addressLine: z.string().trim().min(4).max(240),
  directions: z.string().trim().max(500).optional().default(""),
}).strict();

export async function GET(request: Request) {
  try {
    const user = await requireUser(request);
    const snapshot = await getFirebaseAdminDb().collection("users").doc(user.uid).collection("addresses").orderBy("createdAt", "desc").limit(20).get();
    const addresses = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data(), createdAt: doc.get("createdAt")?.toDate?.().toISOString?.() ?? null }));
    return jsonOk({ addresses });
  } catch (error) {
    return apiFailure(error);
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireUser(request);
    const parsed = AddressSchema.safeParse(await readJson(request, 12 * 1024));
    if (!parsed.success) return jsonOk({ error: "ADDRESS_INVALID" }, 400);
    const commune = await getActiveCommune(parsed.data.communeCode);
    if (commune.departmentName !== parsed.data.department) throw new ApiError(422, "ADDRESS_COMMUNE_MISMATCH");
    const db = getFirebaseAdminDb();
    const userRef = db.collection("users").doc(user.uid);
    const addressesRef = db.collection("users").doc(user.uid).collection("addresses");
    const addressRef = addressesRef.doc();
    await db.runTransaction(async (transaction) => {
      const [userSnapshot, addresses] = await Promise.all([
        transaction.get(userRef),
        transaction.get(addressesRef.limit(20)),
      ]);
      const knownCount = Number(userSnapshot.get("addressCount"));
      const count = Number.isInteger(knownCount) && knownCount >= addresses.size ? knownCount : addresses.size;
      if (count >= 20) throw new ApiError(409, "ADDRESS_LIMIT_REACHED");
      transaction.create(addressRef, { ...parsed.data, countryCode: "HT", createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
      transaction.set(userRef, { addressCount: count + 1, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    });
    return jsonOk({ id: addressRef.id }, 201);
  } catch (error) {
    return apiFailure(error);
  }
}
