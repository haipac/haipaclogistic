import { ApiError } from "@/lib/firebase/auth";

const PRIVATE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  "X-Content-Type-Options": "nosniff",
};

export function jsonOk<T>(payload: T, status = 200) {
  return Response.json(payload, { status, headers: PRIVATE_HEADERS });
}

export async function readJson(request: Request, maxBytes = 64 * 1024): Promise<unknown> {
  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (declaredLength > maxBytes) throw new ApiError(413, "REQUEST_TOO_LARGE");
  if (!request.headers.get("content-type")?.toLowerCase().includes("application/json")) {
    throw new ApiError(415, "JSON_REQUIRED");
  }

  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > maxBytes) {
    throw new ApiError(413, "REQUEST_TOO_LARGE");
  }
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new ApiError(400, "INVALID_JSON");
  }
}

export function apiFailure(error: unknown) {
  if (error instanceof ApiError) {
    return Response.json({ error: error.code }, { status: error.status, headers: PRIVATE_HEADERS });
  }
  if (error instanceof Error && (error.message.startsWith("FIREBASE_") || error.message.startsWith("GCP_"))) {
    return Response.json({ error: "SERVICE_NOT_CONFIGURED" }, { status: 503, headers: PRIVATE_HEADERS });
  }
  return Response.json({ error: "INTERNAL_ERROR" }, { status: 500, headers: PRIVATE_HEADERS });
}

export function safeText(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}
