import type { DecodedIdToken } from "firebase-admin/auth";
import { getFirebaseAdminAuth } from "@/lib/firebase/admin";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
  ) {
    super(code);
  }
}

export async function requireUser(request: Request): Promise<DecodedIdToken> {
  const authorization = request.headers.get("authorization") ?? "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  if (!match) throw new ApiError(401, "AUTH_REQUIRED");

  try {
    const user = await getFirebaseAdminAuth().verifyIdToken(match[1], true);
    if (!user.email_verified) throw new ApiError(403, "EMAIL_VERIFICATION_REQUIRED");
    return user;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(401, "AUTH_INVALID");
  }
}

export async function requireAdmin(request: Request): Promise<DecodedIdToken> {
  const user = await requireUser(request);
  if (user.haipacRole !== "admin") throw new ApiError(403, "ADMIN_REQUIRED");
  return user;
}

export async function requireOperations(request: Request): Promise<DecodedIdToken> {
  const user = await requireUser(request);
  if (!["admin", "operations"].includes(String(user.haipacRole ?? ""))) {
    throw new ApiError(403, "OPERATIONS_REQUIRED");
  }
  return user;
}

export function apiErrorResponse(error: unknown) {
  if (error instanceof ApiError) {
    return Response.json({ error: error.code }, { status: error.status });
  }
  if (
    error instanceof Error &&
    (error.message.startsWith("FIREBASE_") || error.message.startsWith("GCP_"))
  ) {
    return Response.json({ error: "SERVICE_NOT_CONFIGURED" }, { status: 503 });
  }
  return Response.json({ error: "INTERNAL_ERROR" }, { status: 500 });
}
