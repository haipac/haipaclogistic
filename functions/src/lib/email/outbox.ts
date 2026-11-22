import { FieldValue, Timestamp, type Firestore, type Transaction } from "firebase-admin/firestore";
import { ApiError } from "@/lib/firebase/auth";
import { encryptPrivatePayload } from "@/lib/security/secrets";

export type EmailTemplate = "claim_shipment" | "delivery_code";

export function queueEmail(
  transaction: Transaction,
  db: Firestore,
  input: { template: EmailTemplate; to: string; subject: string; data: Record<string, string> },
) {
  const normalizedEmail = input.to.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) throw new ApiError(422, "RECIPIENT_EMAIL_INVALID");
  const ref = db.collection("emailOutbox").doc();
  transaction.create(ref, {
    template: input.template,
    to: normalizedEmail,
    subject: input.subject,
    encryptedData: encryptPrivatePayload(input.data),
    status: "pending",
    attempts: 0,
    availableAt: Timestamp.now(),
    createdAt: FieldValue.serverTimestamp(),
    expiresAt: Timestamp.fromMillis(Date.now() + 30 * 24 * 60 * 60 * 1000),
  });
  return ref.id;
}
