import assert from "node:assert/strict";
import { createDecipheriv, createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";

const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST ?? "";
assert.match(emulatorHost, /^(127\.0\.0\.1|localhost):\d+$/, "Firestore tests must use a local emulator");
assert.equal(process.env.FIREBASE_PROJECT_ID, "haipac-7e19d", "Use the HAIPAC project ID with emulator-only credentials");
assert.ok(Buffer.byteLength(process.env.SMARTCUT_HMAC_SECRET ?? "") >= 32, "A synthetic test HMAC secret is required");

const apiBaseUrl = process.env.HAIPAC_TEST_BASE_URL ?? "http://127.0.0.1:5000";
assert.match(apiBaseUrl, /^http:\/\/(127\.0\.0\.1|localhost):5000$/, "Tests must call the local Firebase Hosting emulator");

const integrationApp = initializeApp({ projectId: "haipac-7e19d" }, "haipac-flow-integration");
const db = getFirestore(integrationApp);
const hmacSecret = process.env.SMARTCUT_HMAC_SECRET!;
const quotePath = "/api/v1/quotes";
const reservePath = "/api/v1/integrations/quotes/reserve";
const shipmentsPath = "/api/v1/integrations/shipments";
let communeCode = "";

function signedHeaders(path: string, payload: Record<string, unknown>, idempotencyKey: string) {
  const rawBody = JSON.stringify(payload);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const nonce = randomBytes(18).toString("base64url");
  const bodyHash = createHash("sha256").update(rawBody, "utf8").digest("hex");
  const canonical = ["v1", "POST", path, timestamp, nonce, bodyHash].join("\n");
  const signature = createHmac("sha256", hmacSecret).update(canonical, "utf8").digest("hex");

  return {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey,
      "x-haipac-timestamp": timestamp,
      "x-haipac-nonce": nonce,
      "x-haipac-signature": signature,
    },
    body: rawBody,
  };
}

async function postSigned<T>(path: string, payload: Record<string, unknown>, idempotencyKey: string) {
  const response = await fetch(apiBaseUrl + path, signedHeaders(path, payload, idempotencyKey));
  return { response, body: await response.json() as T };
}

async function createQuote(realWeightKg: number) {
  const checkoutRef = "checkout-" + randomUUID().replaceAll("-", "");
  const payload = {
    checkoutRef,
    destinationCommuneCode: communeCode,
    parcels: [{
      packageRef: "unit-1-1",
      lengthCm: 30,
      widthCm: 20,
      heightCm: 12,
      realWeightKg,
    }],
  };
  const { response, body } = await postSigned<{
    quoteId?: string;
    error?: string;
    amountHtg?: number;
    parcels?: Array<Record<string, unknown>>;
    [key: string]: unknown;
  }>(quotePath, payload, "smartcut-quote-" + checkoutRef);
  assert.equal(response.status, 201, body.error || "Quote creation failed");
  return { quote: body, checkoutRef };
}

async function reserveQuote(quoteId: string, checkoutRef: string, smartCutOrderId: string) {
  const payload = { quoteId, checkoutRef, smartCutOrderId };
  return postSigned<{ quoteId?: string; amountHtg?: number; error?: string }>(
    reservePath,
    payload,
    "smartcut-reservation-" + quoteId + "-" + smartCutOrderId,
  );
}

function shipmentPayload(quoteId: string, checkoutRef: string, smartCutOrderId: string) {
  return {
    paymentStatus: "paid",
    paymentVerifiedAt: new Date().toISOString(),
    paymentReference: "emulator-payment-" + smartCutOrderId,
    quoteId,
    checkoutRef,
    smartCutOrderId,
    recipientName: "Test Recipient",
    recipientEmail: "test@example.com",
    recipientPhone: "+50937000000",
    destinationCommuneCode: communeCode,
    locality: "Port-au-Prince",
    addressLine: "123 Rue de Test",
    directions: "Adresse de test",
  };
}

before(async () => {
  communeCode = "OU-TEST-" + randomUUID().slice(0, 8).toUpperCase();
  await db.collection("communes").doc(communeCode).set({
    code: communeCode,
    name: "Commune de test",
    departmentCode: "OU",
    departmentName: "Ouest",
    active: true,
  });
  await db.collection("settings").doc("dispatch").set({ originCommuneCode: communeCode });

  const rateVersion = "emulator-" + randomUUID().slice(0, 8);
  const firstTier = {
    minBillableKg: 1,
    maxBillableKg: 30,
    method: "first_kg_plus_additional",
    firstKgHtg: 100,
    additionalKgHtg: 10,
  };
  const secondTier = {
    minBillableKg: 31,
    maxBillableKg: 100,
    method: "per_kg",
    pricePerKgHtg: 7,
  };
  await db.collection("rateCards").doc(rateVersion).set({
    version: rateVersion,
    status: "active",
    effectiveFrom: "2026-01-01",
    effectiveUntil: null,
    currency: "HTG",
    tierBasis: "rounded_billable_kg",
    volumetricDivisor: 6000,
    minimumBillableKg: 1,
    maxAutoQuoteKg: 100,
    zones: {
      local: [firstTier, secondTier],
      regional: [firstTier, secondTier],
      national: [firstTier, secondTier],
    },
  });
  await db.collection("settings").doc("rates").set({ activeVersion: rateVersion });
});

after(async () => {
  await db.terminate();
  await deleteApp(integrationApp);
});

test("the signed API rounds 30.99 kg before selecting the 31 kg tier", async () => {
  const { quote } = await createQuote(30.99);
  const parcel = quote.parcels![0];
  const weight = parcel.weight as Record<string, unknown>;

  assert.equal(weight.roundedBillableWeightKg, 31);
  assert.equal(parcel.tierMethod, "per_kg");
  assert.equal(parcel.amountHtg, 217);
  assert.equal(quote.amountHtg, 217);
});

test("quote, reservation, paid shipment, encrypted claim email, and retry are idempotent", async () => {
  const { quote, checkoutRef } = await createQuote(2.1);
  const quoteId = String(quote.quoteId);
  const parcel = quote.parcels![0];
  const weight = parcel.weight as Record<string, unknown>;
  assert.equal(weight.roundedBillableWeightKg, 3);
  assert.equal(parcel.amountHtg, 120);

  const orderId = "order-" + randomUUID();
  const reservation = await reserveQuote(quoteId, checkoutRef, orderId);
  assert.equal(reservation.response.status, 200);
  assert.equal(reservation.body.quoteId, quoteId);
  assert.equal(reservation.body.amountHtg, 120);

  const payload = shipmentPayload(quoteId, checkoutRef, orderId);
  const idempotencyKey = "smartcut-order-" + orderId;
  const first = await postSigned<{
    smartCutOrderId: string;
    shipments: Array<{ packageRef: string; trackingNumber: string }>;
    error?: string;
  }>(shipmentsPath, payload, idempotencyKey);
  assert.equal(first.response.status, 201, first.body.error || "Shipment creation failed");
  assert.equal(first.body.smartCutOrderId, orderId);
  assert.equal(first.body.shipments.length, 1);
  assert.equal(first.body.shipments[0].packageRef, "unit-1-1");
  assert.match(first.body.shipments[0].trackingNumber, /^HPL\d{10}$/);

  const replay = await postSigned<{
    shipments: Array<{ packageRef: string; trackingNumber: string }>;
  }>(shipmentsPath, payload, idempotencyKey);
  assert.equal(replay.response.status, 200);
  assert.deepEqual(replay.body.shipments, first.body.shipments);

  const [shipments, tracking, claims, outbox] = await Promise.all([
    db.collection("shipments").where("smartCutOrderId", "==", orderId).get(),
    db.collection("tracking").doc(first.body.shipments[0].trackingNumber).get(),
    db.collection("claimTokens").where("recipientEmail", "==", "test@example.com").get(),
    db.collection("emailOutbox").where("to", "==", "test@example.com").get(),
  ]);
  assert.equal(shipments.size, 1);
  assert.equal(tracking.get("status"), "registered");
  assert.equal(claims.size, 1);
  assert.equal(outbox.size, 1);
  assert.equal(typeof outbox.docs[0].get("encryptedData")?.ciphertext, "string");

  const encrypted = outbox.docs[0].get("encryptedData");
  const decipher = createDecipheriv("aes-256-gcm", Buffer.from(process.env.CLAIM_TOKEN_ENCRYPTION_KEY!, "base64"), Buffer.from(encrypted.iv, "base64url"));
  decipher.setAuthTag(Buffer.from(encrypted.tag, "base64url"));
  const emailData = JSON.parse(Buffer.concat([
    decipher.update(Buffer.from(encrypted.ciphertext, "base64url")),
    decipher.final(),
  ]).toString("utf8")) as { claimUrl: string };
  assert.match(emailData.claimUrl, /^https:\/\/haipac\.example\.test\/revendiquer\?token=/);
});

test("a payment confirmed after reservation expiry cannot create a shipment", async () => {
  const { quote, checkoutRef } = await createQuote(1);
  const quoteId = String(quote.quoteId);
  const orderId = "expired-order-" + randomUUID();
  const reservation = await reserveQuote(quoteId, checkoutRef, orderId);
  assert.equal(reservation.response.status, 200);

  await db.collection("quotes").doc(quoteId).update({
    paymentExpiresAt: Timestamp.fromMillis(Date.now() - 1_000),
  });

  const result = await postSigned<{ error?: string }>(
    shipmentsPath,
    shipmentPayload(quoteId, checkoutRef, orderId),
    "smartcut-order-" + orderId,
  );
  assert.equal(result.response.status, 409);
  assert.deepEqual(result.body, { error: "PAYMENT_RESERVATION_EXPIRED" });

  const shipments = await db.collection("shipments").where("smartCutOrderId", "==", orderId).get();
  assert.equal(shipments.size, 0);
});
