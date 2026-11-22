import * as account from "./routes/v1/account/route";
import * as accountProfile from "./routes/v1/account/profile/route";
import * as accountAddresses from "./routes/v1/account/addresses/route";
import * as claims from "./routes/v1/claims/route";
import * as communes from "./routes/v1/communes/route";
import * as publicRates from "./routes/v1/rates/route";
import * as legalContent from "./routes/v1/legal-content/[documentId]/route";
import * as quotes from "./routes/v1/quotes/route";
import * as tracking from "./routes/v1/tracking/[trackingNumber]/route";
import * as quoteReserve from "./routes/v1/integrations/quotes/reserve/route";
import * as integrationShipments from "./routes/v1/integrations/shipments/route";
import * as operationsShipments from "./routes/v1/operations/shipments/route";
import * as operationsShipment from "./routes/v1/operations/shipments/[trackingNumber]/route";
import * as deliverShipment from "./routes/v1/operations/shipments/[trackingNumber]/deliver/route";
import * as adminOverview from "./routes/v1/admin/overview/route";
import * as adminLegalContent from "./routes/v1/admin/legal-content/route";
import * as adminLegalContentDocument from "./routes/v1/admin/legal-content/[documentId]/route";
import * as publishAdminLegalContent from "./routes/v1/admin/legal-content/[documentId]/publish/route";
import * as adminPolicies from "./routes/v1/admin/policies/route";
import * as adminPolicy from "./routes/v1/admin/policies/[policyId]/route";
import * as publishAdminPolicy from "./routes/v1/admin/policies/[policyId]/publish/route";
import * as adminDispatchOrigin from "./routes/v1/admin/dispatch-origin/route";
import * as adminCommunes from "./routes/v1/admin/communes/route";
import * as adminCommune from "./routes/v1/admin/communes/[code]/route";
import * as adminRateCards from "./routes/v1/admin/rate-cards/route";
import * as adminRateCard from "./routes/v1/admin/rate-cards/[version]/route";
import * as activateRateCard from "./routes/v1/admin/rate-cards/[version]/activate/route";
import * as adminUserRole from "./routes/v1/admin/users/[uid]/role/route";
import * as emailOutbox from "./routes/v1/internal/process-email-outbox/route";

type Route = {
  method: string;
  pattern: RegExp;
  paramNames?: string[];
  handle: (request: Request, params: Record<string, string>) => Promise<Response>;
};

const routes: Route[] = [
  { method: "GET", pattern: /^\/v1\/account$/, handle: (request) => account.GET(request) },
  { method: "POST", pattern: /^\/v1\/account$/, handle: (request) => account.POST(request) },
  { method: "PATCH", pattern: /^\/v1\/account\/profile$/, handle: (request) => accountProfile.PATCH(request) },
  { method: "GET", pattern: /^\/v1\/account\/addresses$/, handle: (request) => accountAddresses.GET(request) },
  { method: "POST", pattern: /^\/v1\/account\/addresses$/, handle: (request) => accountAddresses.POST(request) },
  { method: "POST", pattern: /^\/v1\/claims$/, handle: (request) => claims.POST(request) },
  { method: "GET", pattern: /^\/v1\/communes$/, handle: () => communes.GET() },
  { method: "GET", pattern: /^\/v1\/rates$/, handle: () => publicRates.GET() },
  {
    method: "GET",
    pattern: /^\/v1\/legal-content\/([^/]+)$/,
    paramNames: ["documentId"],
    handle: (request, params) => legalContent.GET(request, { params: Promise.resolve({ documentId: params.documentId }) }),
  },
  { method: "POST", pattern: /^\/v1\/quotes$/, handle: (request) => quotes.POST(request) },
  {
    method: "GET",
    pattern: /^\/v1\/tracking\/([^/]+)$/,
    paramNames: ["trackingNumber"],
    handle: (request, params) => tracking.GET(request, { params: Promise.resolve({ trackingNumber: params.trackingNumber }) }),
  },
  { method: "POST", pattern: /^\/v1\/integrations\/quotes\/reserve$/, handle: (request) => quoteReserve.POST(request) },
  { method: "POST", pattern: /^\/v1\/integrations\/shipments$/, handle: (request) => integrationShipments.POST(request) },
  { method: "GET", pattern: /^\/v1\/operations\/shipments$/, handle: (request) => operationsShipments.GET(request) },
  {
    method: "PATCH",
    pattern: /^\/v1\/operations\/shipments\/([^/]+)$/,
    paramNames: ["trackingNumber"],
    handle: (request, params) => operationsShipment.PATCH(request, { params: Promise.resolve({ trackingNumber: params.trackingNumber }) }),
  },
  {
    method: "POST",
    pattern: /^\/v1\/operations\/shipments\/([^/]+)\/deliver$/,
    paramNames: ["trackingNumber"],
    handle: (request, params) => deliverShipment.POST(request, { params: Promise.resolve({ trackingNumber: params.trackingNumber }) }),
  },
  { method: "GET", pattern: /^\/v1\/admin\/overview$/, handle: (request) => adminOverview.GET(request) },
  { method: "GET", pattern: /^\/v1\/admin\/legal-content$/, handle: (request) => adminLegalContent.GET(request) },
  {
    method: "PUT",
    pattern: /^\/v1\/admin\/legal-content\/([^/]+)$/,
    paramNames: ["documentId"],
    handle: (request, params) => adminLegalContentDocument.PUT(request, { params: Promise.resolve({ documentId: params.documentId }) }),
  },
  {
    method: "POST",
    pattern: /^\/v1\/admin\/legal-content\/([^/]+)\/publish$/,
    paramNames: ["documentId"],
    handle: (request, params) => publishAdminLegalContent.POST(request, { params: Promise.resolve({ documentId: params.documentId }) }),
  },
  { method: "GET", pattern: /^\/v1\/admin\/policies$/, handle: (request) => adminPolicies.GET(request) },
  {
    method: "PUT",
    pattern: /^\/v1\/admin\/policies\/([^/]+)$/,
    paramNames: ["policyId"],
    handle: (request, params) => adminPolicy.PUT(request, { params: Promise.resolve({ policyId: params.policyId }) }),
  },
  {
    method: "POST",
    pattern: /^\/v1\/admin\/policies\/([^/]+)\/publish$/,
    paramNames: ["policyId"],
    handle: (request, params) => publishAdminPolicy.POST(request, { params: Promise.resolve({ policyId: params.policyId }) }),
  },
  { method: "GET", pattern: /^\/v1\/admin\/dispatch-origin$/, handle: (request) => adminDispatchOrigin.GET(request) },
  { method: "PUT", pattern: /^\/v1\/admin\/dispatch-origin$/, handle: (request) => adminDispatchOrigin.PUT(request) },
  { method: "GET", pattern: /^\/v1\/admin\/communes$/, handle: (request) => adminCommunes.GET(request) },
  {
    method: "PUT",
    pattern: /^\/v1\/admin\/communes\/([^/]+)$/,
    paramNames: ["code"],
    handle: (request, params) => adminCommune.PUT(request, { params: Promise.resolve({ code: params.code }) }),
  },
  { method: "GET", pattern: /^\/v1\/admin\/rate-cards$/, handle: (request) => adminRateCards.GET(request) },
  {
    method: "PUT",
    pattern: /^\/v1\/admin\/rate-cards\/([^/]+)$/,
    paramNames: ["version"],
    handle: (request, params) => adminRateCard.PUT(request, { params: Promise.resolve({ version: params.version }) }),
  },
  {
    method: "POST",
    pattern: /^\/v1\/admin\/rate-cards\/([^/]+)\/activate$/,
    paramNames: ["version"],
    handle: (request, params) => activateRateCard.POST(request, { params: Promise.resolve({ version: params.version }) }),
  },
  {
    method: "PUT",
    pattern: /^\/v1\/admin\/users\/([^/]+)\/role$/,
    paramNames: ["uid"],
    handle: (request, params) => adminUserRole.PUT(request, { params: Promise.resolve({ uid: params.uid }) }),
  },
  { method: "GET", pattern: /^\/v1\/internal\/process-email-outbox$/, handle: (request) => emailOutbox.GET(request) },
  { method: "POST", pattern: /^\/v1\/internal\/process-email-outbox$/, handle: (request) => emailOutbox.POST(request) },
];

const allowedOrigins = new Set([
  "https://haipac-7e19d.web.app",
  "https://haipac-7e19d.firebaseapp.com",
  "https://www.haipaclogistics.com",
  "https://haipaclogistics.com",
  "http://localhost:5500",
  "http://127.0.0.1:5500",
]);

const allowedMethods = "GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS";
const allowedHeaders = "Authorization, Content-Type, Idempotency-Key, X-Haipac-Timestamp, X-Haipac-Nonce, X-Haipac-Signature";

function normalizePath(path: string) {
  const withoutApiPrefix = path === "/api" ? "/" : path.startsWith("/api/") ? path.slice(4) : path;
  return withoutApiPrefix.length > 1 ? withoutApiPrefix.replace(/\/$/, "") : withoutApiPrefix;
}

function decodeParams(names: string[], match: RegExpMatchArray) {
  return Object.fromEntries(match.slice(1).map((value, index) => [names[index], decodeURIComponent(value)]));
}

function jsonError(status: number, code: string, allow?: string[]) {
  const headers = new Headers({
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  if (allow?.length) headers.set("Allow", allow.join(", "));
  return new Response(JSON.stringify({ error: code }), { status, headers });
}

function isAllowedOrigin(origin: string) {
  const configuredOrigins = (process.env.HAIPAC_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  return allowedOrigins.has(origin) || configuredOrigins.includes(origin);
}

function addCors(request: Request, response: Response) {
  const headers = new Headers(response.headers);
  const origin = request.headers.get("origin");
  headers.set("Vary", "Origin");
  if (origin && isAllowedOrigin(origin)) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Access-Control-Allow-Methods", allowedMethods);
    headers.set("Access-Control-Allow-Headers", allowedHeaders);
    headers.set("Access-Control-Max-Age", "600");
  }
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export async function handleApiRequest(request: Request, clientIp?: string): Promise<Response> {
  const origin = request.headers.get("origin");
  if (request.method === "OPTIONS") {
    return addCors(
      request,
      origin && !isAllowedOrigin(origin)
        ? jsonError(403, "ORIGIN_NOT_ALLOWED")
        : new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } }),
    );
  }

  let requestPath: string;
  try {
    requestPath = normalizePath(new URL(request.url).pathname);
  } catch {
    return addCors(request, jsonError(400, "INVALID_PATH"));
  }

  const pathMatches = routes.flatMap((route) => {
    const match = requestPath.match(route.pattern);
    return match ? [{ route, match }] : [];
  });
  const selected = pathMatches.find(({ route }) => route.method === request.method);
  if (!selected) {
    return addCors(
      request,
      pathMatches.length
        ? jsonError(405, "METHOD_NOT_ALLOWED", [...new Set(pathMatches.map(({ route }) => route.method))])
        : jsonError(404, "NOT_FOUND"),
    );
  }

  let params: Record<string, string>;
  try {
    params = decodeParams(selected.route.paramNames ?? [], selected.match);
  } catch {
    return addCors(request, jsonError(400, "INVALID_PATH"));
  }

  try {
    let routeRequest = request;
    if (clientIp && !request.headers.has("x-forwarded-for")) {
      const headers = new Headers(request.headers);
      headers.set("x-forwarded-for", clientIp);
      routeRequest = new Request(request, { headers });
    }
    return addCors(request, await selected.route.handle(routeRequest, params));
  } catch {
    return addCors(request, jsonError(500, "INTERNAL_ERROR"));
  }
}

export async function processEmailOutbox(request: Request) {
  return emailOutbox.processOutbox(request);
}
