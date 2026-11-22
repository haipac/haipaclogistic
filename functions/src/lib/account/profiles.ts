import { FieldValue, type DocumentData } from "firebase-admin/firestore";
import { getFirebaseAdminDb } from "@/lib/firebase/admin";
import { ApiError } from "@/lib/firebase/auth";

export async function ensureAccount(uid: string, email: string) {
  const db = getFirebaseAdminDb();
  const userRef = db.collection("users").doc(uid);
  const counterRef = db.collection("system").doc("caseCounter");

  return db.runTransaction(async (transaction) => {
    const userSnapshot = await transaction.get(userRef);
    if (userSnapshot.exists && typeof userSnapshot.get("caseNumber") === "string") {
      return userSnapshot.data();
    }

    const counterSnapshot = await transaction.get(counterRef);
    const caseNumberValue = counterSnapshot.exists ? counterSnapshot.get("nextNumber") : 100000;
    if (!Number.isSafeInteger(caseNumberValue) || caseNumberValue < 100000 || caseNumberValue > 999999) {
      throw new ApiError(503, "CASE_NUMBER_CAPACITY_REACHED");
    }
    const caseNumber = `HPL${String(caseNumberValue).padStart(6, "0")}`;
    const profile: DocumentData = {
      email: email.trim().toLowerCase(),
      caseNumber,
      ...(userSnapshot.exists && userSnapshot.get("createdAt") ? {} : { createdAt: FieldValue.serverTimestamp() }),
      updatedAt: FieldValue.serverTimestamp(),
    };

    transaction.set(counterRef, { nextNumber: caseNumberValue + 1, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    transaction.set(userRef, profile, { merge: true });
    return { ...profile, caseNumber };
  });
}

export function accountDto(uid: string, data: DocumentData | undefined) {
  return {
    uid,
    email: typeof data?.email === "string" ? data.email : "",
    caseNumber: typeof data?.caseNumber === "string" ? data.caseNumber : null,
    displayName: typeof data?.displayName === "string" ? data.displayName : "",
    phone: typeof data?.phone === "string" ? data.phone : "",
    createdAt: data?.createdAt?.toDate?.().toISOString?.() ?? null,
  };
}
