import { FieldValue, Timestamp, type DocumentData, type Query } from "firebase-admin/firestore";
import { timingSafeEqual } from "node:crypto";
import { getFirebaseAdminDb } from "@/lib/firebase/admin";
import { apiFailure, jsonOk } from "@/lib/api/http";
import { ApiError } from "@/lib/firebase/auth";
import { requireProductionReadiness } from "@/lib/api/production-readiness";
import { decryptPrivatePayload } from "@/lib/security/secrets";

export const maxDuration = 60;

type PrivateMailData = { claimUrl?: string; trackingNumber?: string; recipientName?: string; code?: string };

function equalSecret(supplied: string, expected: string) {
  const a = Buffer.from(supplied);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
}

function emailContent(template: string, data: PrivateMailData) {
  const name = escapeHtml(data.recipientName ?? "");
  const tracking = escapeHtml(data.trackingNumber ?? "");
  if (template === "claim_shipment" && data.claimUrl) {
    const url = escapeHtml(data.claimUrl);
    return {
      html: `<p>Bonjour${name ? ` ${name}` : ""},</p><p>Un colis HAIPAC est associé à votre adresse. Utilisez ce lien personnel pour rattacher le suivi à votre compte :</p><p><a href="${url}">Rattacher le colis ${tracking}</a></p><p>Ce lien expire dans 14 jours et ne peut être utilisé qu’une fois. Connectez-vous avec l’adresse qui a reçu ce message.</p>`,
      text: `Bonjour${name ? ` ${name}` : ""},\n\nUn colis HAIPAC est associé à votre adresse. Rattachez le suivi à votre compte avec ce lien personnel : ${data.claimUrl}\n\nLe lien expire dans 14 jours et ne peut être utilisé qu’une fois.\nNuméro : ${tracking}`,
    };
  }
  if (template === "delivery_code" && data.code) {
    const code = escapeHtml(data.code);
    return {
      html: `<p>Bonjour${name ? ` ${name}` : ""},</p><p>Votre colis HAIPAC ${tracking} est en cours de livraison.</p><p>Code de remise : <strong>${code}</strong></p><p>Ne communiquez ce code qu’au moment de recevoir votre colis.</p>`,
      text: `Bonjour${name ? ` ${name}` : ""},\n\nVotre colis HAIPAC ${tracking} est en cours de livraison.\nCode de remise : ${data.code}\n\nNe communiquez ce code qu’au moment de recevoir votre colis.`,
    };
  }
  throw new ApiError(422, "EMAIL_TEMPLATE_DATA_INVALID");
}

async function lockOutbox(id: string) {
  const db = getFirebaseAdminDb();
  const ref = db.collection("emailOutbox").doc(id);
  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists) return null;
    const status = snapshot.get("status");
    const now = Date.now();
    const availableAt = snapshot.get("availableAt")?.toDate?.().getTime?.() ?? 0;
    const lockedUntil = snapshot.get("lockedUntil")?.toDate?.().getTime?.() ?? 0;
    if (status === "sent" || status === "failed" || availableAt > now || (status === "processing" && lockedUntil > now)) return null;
    const attempts = Number(snapshot.get("attempts") ?? 0) + 1;
    transaction.update(ref, {
      status: "processing",
      attempts,
      lockedUntil: Timestamp.fromMillis(now + 2 * 60_000),
      lastAttemptAt: FieldValue.serverTimestamp(),
    });
    return { ref, data: snapshot.data()!, attempts };
  });
}

async function handleMessage(id: string) {
  const resendApiKey = process.env.RESEND_API_KEY;
  const sender = process.env.EMAIL_FROM;
  if (!resendApiKey || !sender) throw new ApiError(503, "EMAIL_PROVIDER_NOT_CONFIGURED");
  const locked = await lockOutbox(id);
  if (!locked) return false;

  try {
    const encryptedData = locked.data.encryptedData as { version: number; iv: string; tag: string; ciphertext: string };
    const data = decryptPrivatePayload<PrivateMailData>(encryptedData);
    const content = emailContent(String(locked.data.template), data);
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": `haipac-email-${id}`,
      },
      body: JSON.stringify({
        from: sender,
        to: [String(locked.data.to)],
        subject: String(locked.data.subject),
        html: content.html,
        text: content.text,
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`RESEND_HTTP_${response.status}`);
    const receipt = await response.json().catch(() => ({})) as { id?: string };
    await locked.ref.update({
      status: "sent",
      providerId: typeof receipt.id === "string" ? receipt.id : null,
      sentAt: FieldValue.serverTimestamp(),
      lockedUntil: FieldValue.delete(),
      lastErrorCode: FieldValue.delete(),
    });
    return true;
  } catch (error) {
    const attemptLimit = 6;
    const dead = locked.attempts >= attemptLimit;
    const delayMs = Math.min(60 * 60_000, 30_000 * 2 ** Math.max(0, locked.attempts - 1));
    const safeError = error instanceof Error && /^RESEND_HTTP_\d+$/.test(error.message) ? error.message : "EMAIL_DELIVERY_FAILED";
    await locked.ref.update({
      status: dead ? "failed" : "pending",
      availableAt: Timestamp.fromMillis(Date.now() + delayMs),
      lockedUntil: FieldValue.delete(),
      lastErrorCode: safeError,
      lastAttemptAt: FieldValue.serverTimestamp(),
    });
    return false;
  }
}

async function readyIds(query: Query<DocumentData>) {
  const result = await query.get();
  return result.docs.map((doc) => doc.id);
}

export async function processOutbox(request: Request) {
  try {
    const expected = process.env.CRON_SECRET ?? "";
    const supplied = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
    if (expected.length < 32 || !equalSecret(supplied, expected)) throw new ApiError(401, "CRON_AUTH_REQUIRED");
    if (
      process.env.EMAIL_PROVIDER_CONFIGURED !== "true" ||
      process.env.LEGAL_CONTENT_APPROVED !== "true" ||
      process.env.OPERATIONS_READY !== "true"
    ) {
      throw new ApiError(503, "EMAIL_DELIVERY_DISABLED");
    }
    await requireProductionReadiness();
    const db = getFirebaseAdminDb();
    const now = Timestamp.now();
    const [pending, stale] = await Promise.all([
      readyIds(db.collection("emailOutbox").where("status", "==", "pending").where("availableAt", "<=", now).orderBy("availableAt").limit(5)),
      readyIds(db.collection("emailOutbox").where("status", "==", "processing").where("lockedUntil", "<=", now).orderBy("lockedUntil").limit(5)),
    ]);
    const ids = [...new Set([...pending, ...stale])].slice(0, 5);
    const results = await Promise.all(ids.map((id) => handleMessage(id)));
    const sent = results.filter(Boolean).length;
    return jsonOk({ processed: ids.length, sent });
  } catch (error) {
    return apiFailure(error);
  }
}

export async function GET(request: Request) {
  return processOutbox(request);
}

export async function POST(request: Request) {
  return processOutbox(request);
}
