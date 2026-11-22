import assert from "node:assert/strict";
import test from "node:test";
import { handleApiRequest, processEmailOutbox } from "./api";

test("API answers unknown routes without touching Firebase", async () => {
  const response = await handleApiRequest(new Request("https://haipac-api.example.test/api/v1/missing"));
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { error: "NOT_FOUND" });
  assert.equal(response.headers.get("cache-control"), "no-store");
});

test("API rejects unsupported methods for known routes", async () => {
  const response = await handleApiRequest(new Request("https://haipac-api.example.test/api/v1/communes", { method: "POST" }));
  assert.equal(response.status, 405);
  assert.equal(response.headers.get("allow"), "GET");
});

test("admin policy endpoints require an authenticated admin before reading or writing", async () => {
  const read = await handleApiRequest(new Request("https://haipac-api.example.test/api/v1/admin/policies"));
  assert.equal(read.status, 401);
  assert.deepEqual(await read.json(), { error: "AUTH_REQUIRED" });

  const save = await handleApiRequest(new Request("https://haipac-api.example.test/api/v1/admin/policies/operations", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ title: "Test", body: "x".repeat(100) }),
  }));
  assert.equal(save.status, 401);
  assert.deepEqual(await save.json(), { error: "AUTH_REQUIRED" });

  const publish = await handleApiRequest(new Request("https://haipac-api.example.test/api/v1/admin/policies/operations/publish", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ confirm: true }),
  }));
  assert.equal(publish.status, 401);
  assert.deepEqual(await publish.json(), { error: "AUTH_REQUIRED" });
});

test("API preflight allows only configured HAIPAC origins", async () => {
  const allowed = await handleApiRequest(
    new Request("https://haipac-api.example.test/api/v1/communes", {
      method: "OPTIONS",
      headers: { origin: "https://haipac-7e19d.web.app" },
    }),
  );
  assert.equal(allowed.status, 204);
  assert.equal(allowed.headers.get("access-control-allow-origin"), "https://haipac-7e19d.web.app");
  assert.match(allowed.headers.get("access-control-allow-headers") ?? "", /authorization/i);

  const denied = await handleApiRequest(
    new Request("https://haipac-api.example.test/api/v1/communes", {
      method: "OPTIONS",
      headers: { origin: "https://untrusted.example" },
    }),
  );
  assert.equal(denied.status, 403);
  assert.equal(denied.headers.get("access-control-allow-origin"), null);
});

test("email outbox scheduler requires its bearer secret", async () => {
  const oldSecret = process.env.CRON_SECRET;
  process.env.CRON_SECRET = "synthetic-cron-secret-with-at-least-32-bytes";
  try {
    const response = await processEmailOutbox(
      new Request("https://haipac.internal/api/v1/internal/process-email-outbox", {
        method: "POST",
        headers: { authorization: "Bearer wrong-secret" },
      }),
    );
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { error: "CRON_AUTH_REQUIRED" });
  } finally {
    if (oldSecret === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = oldSecret;
  }
});

test("email outbox refuses to send until provider, legal, and operations readiness are approved", async () => {
  const previous = {
    cron: process.env.CRON_SECRET,
    emailProvider: process.env.EMAIL_PROVIDER_CONFIGURED,
    legal: process.env.LEGAL_CONTENT_APPROVED,
    operations: process.env.OPERATIONS_READY,
  };
  process.env.CRON_SECRET = "synthetic-cron-secret-with-at-least-32-bytes";
  process.env.EMAIL_PROVIDER_CONFIGURED = "true";
  process.env.LEGAL_CONTENT_APPROVED = "true";
  process.env.OPERATIONS_READY = "false";
  try {
    const response = await processEmailOutbox(
      new Request("https://haipac.internal/api/v1/internal/process-email-outbox", {
        method: "POST",
        headers: { authorization: `Bearer ${process.env.CRON_SECRET}` },
      }),
    );
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: "EMAIL_DELIVERY_DISABLED" });
  } finally {
    if (previous.cron === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = previous.cron;
    if (previous.emailProvider === undefined) delete process.env.EMAIL_PROVIDER_CONFIGURED;
    else process.env.EMAIL_PROVIDER_CONFIGURED = previous.emailProvider;
    if (previous.legal === undefined) delete process.env.LEGAL_CONTENT_APPROVED;
    else process.env.LEGAL_CONTENT_APPROVED = previous.legal;
    if (previous.operations === undefined) delete process.env.OPERATIONS_READY;
    else process.env.OPERATIONS_READY = previous.operations;
  }
});
