import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = path.join(root, "site");
const output = path.join(root, "dist");
const basePath = process.env.HAIPAC_BASE_PATH || "/";
if (!basePath.startsWith("/") || !basePath.endsWith("/")) {
  throw new Error("HAIPAC_BASE_PATH must start and end with a slash");
}
const mode = process.env.HAIPAC_MODE || "emulator";
if (!new Set(["emulator", "production"]).has(mode)) throw new Error("HAIPAC_MODE must be emulator or production");
const publicUrl = (process.env.HAIPAC_PUBLIC_URL || "https://haipac-7e19d.web.app").trim().replace(/\/$/, "");
const allowedPublicUrls = new Set([
  "https://haipac-7e19d.web.app",
  "https://www.haipaclogistics.com",
]);
if (!allowedPublicUrls.has(publicUrl)) {
  throw new Error("HAIPAC_PUBLIC_URL must be the HAIPAC beta or verified www domain URL");
}
function readBoolean(name) {
  const value = (process.env[name] || "false").trim().toLowerCase();
  if (value !== "true" && value !== "false") throw new Error(`${name} must be true or false`);
  return value === "true";
}
const indexingEnabled = readBoolean("HAIPAC_INDEXING_ENABLED");
const legalContentApproved = readBoolean("LEGAL_CONTENT_APPROVED");
const operationsReady = readBoolean("OPERATIONS_READY");
if (indexingEnabled && (
  mode !== "production"
  || !legalContentApproved
  || !operationsReady
  || publicUrl !== "https://www.haipaclogistics.com"
)) {
  throw new Error("Search indexing requires production mode, approved legal content and operations, and the verified www domain");
}
const apiBaseUrl = (process.env.HAIPAC_API_BASE_URL || (mode === "production" ? "" : "/api/")).trim();
const directFunctionsApiUrl = "https://us-east4-haipac-7e19d.cloudfunctions.net/api/";
if (!apiBaseUrl) {
  throw new Error("Production builds require an explicit HAIPAC_API_BASE_URL");
}
if (apiBaseUrl !== "/api/" && apiBaseUrl !== directFunctionsApiUrl) {
  throw new Error(`HAIPAC_API_BASE_URL must be /api/ or the verified HAIPAC Functions endpoint (${directFunctionsApiUrl})`);
}
if (mode !== "production" && apiBaseUrl !== "/api/") {
  throw new Error("The direct Firebase Functions endpoint is only allowed in production builds");
}
const usesDirectFunctionsApi = apiBaseUrl === directFunctionsApiUrl;
const authEmulatorUrl = process.env.HAIPAC_AUTH_EMULATOR_URL || "http://127.0.0.1:9099";

const indexableRoutes = [
  "/",
  "/a-propos/",
  "/services/",
  "/solutions/",
  "/solutions/entreprises/",
  "/solutions/parcours-colis/",
  "/solutions/preparer-un-colis/",
  "/solutions/protection-colis/",
  "/tarifs/",
  "/contact/",
  "/equipe/",
  "/faq/",
  "/guides/",
  "/blog/",
  "/blog/espace-client/",
  "/blog/numero-hpl/",
  "/blog/poids-colis/",
  "/blog/securite-compte/",
  "/blog/suivi-colis/",
  "/blog/tarifs-officiels/",
  "/conditions/",
  "/confidentialite/",
];

function routeForIndexFile(file) {
  const relativeDirectory = path.relative(output, path.dirname(file)).split(path.sep).join("/");
  return !relativeDirectory || relativeDirectory === "." ? "/" : `/${relativeDirectory}/`;
}

await rm(output, { recursive: true, force: true });
await cp(source, output, { recursive: true });
await writeFile(path.join(output, ".nojekyll"), "");
await mkdir(path.join(output, "assets", "js"), { recursive: true });
const htmlFiles = await (async function walk(dir) {
  const { readdir, stat } = await import("node:fs/promises");
  const entries = await readdir(dir);
  const files = [];
  for (const entry of entries) {
    const entryPath = path.join(dir, entry);
    const info = await stat(entryPath);
    if (info.isDirectory()) files.push(...await walk(entryPath));
    else if (entry.endsWith(".html")) files.push(entryPath);
  }
  return files;
})(output);
for (const file of htmlFiles) {
  let content = (await readFile(file, "utf8")).replaceAll("%%HAIPAC_BASE_PATH%%", basePath);
  const currentRoute = routeForIndexFile(file);
  content = content.replace(/href=(["'])#([^"']*)\1/gi, (_match, quote, fragment) =>
    `href=${quote}${basePath}${currentRoute.slice(1)}#${fragment}${quote}`,
  );
  if (usesDirectFunctionsApi) {
    const contentSecurityPolicy = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self' https://identitytoolkit.googleapis.com https://securetoken.googleapis.com https://www.googleapis.com https://us-east4-haipac-7e19d.cloudfunctions.net; img-src 'self' data:; font-src 'self' data:; frame-src https://haipac-7e19d.firebaseapp.com; object-src 'none'; base-uri 'self'; form-action 'self'";
    if (/<meta\s+http-equiv=["']Content-Security-Policy["']/i.test(content)) {
      throw new Error(`A Content-Security-Policy meta tag already exists in ${path.relative(output, file)}`);
    }
    if (!content.includes("</head>")) throw new Error(`Missing closing head tag in ${path.relative(output, file)}`);
    content = content.replace("</head>", `  <meta http-equiv="Content-Security-Policy" content="${contentSecurityPolicy}">\n</head>`);
  }
  if (indexingEnabled && path.basename(file) === "index.html") {
    const route = routeForIndexFile(file);
    const noIndex = /<meta\s+name=["']robots["']\s+content=["']noindex,nofollow["']\s*\/?>/i;
    if (indexableRoutes.includes(route)) {
      if (!noIndex.test(content)) throw new Error(`Indexable page ${route} is missing its expected noindex meta tag`);
      content = content.replace(noIndex, '<meta name="robots" content="index,follow">');
      if (/<link\s+rel=["']canonical["']/i.test(content)) throw new Error(`Page ${route} already has a canonical link`);
      content = content.replace(
        "</head>",
        `  <link rel="canonical" href="${publicUrl}${route}">\n</head>`,
      );
    } else if (!noIndex.test(content)) {
      throw new Error(`Non-indexable page ${route} must keep its noindex meta tag`);
    }
  }
  if (indexingEnabled && path.relative(output, file) === "index.html") {
    const builtRoutes = new Set(htmlFiles
      .filter((candidate) => path.basename(candidate) === "index.html")
      .map(routeForIndexFile));
    const missingRoutes = indexableRoutes.filter((route) => !builtRoutes.has(route));
    if (missingRoutes.length) throw new Error(`Sitemap routes are missing from the build: ${missingRoutes.join(", ")}`);
  }
  await writeFile(file, content);
}
await writeFile(
  path.join(output, "assets", "js", "runtime-config.js"),
  `window.HAIPAC_CONFIG = ${JSON.stringify({ mode, apiBaseUrl, authEmulatorUrl, publicUrl, indexingEnabled })};\n`,
);
await writeFile(
  path.join(output, "robots.txt"),
  indexingEnabled
    ? `User-agent: *\nAllow: /\nSitemap: ${publicUrl}/sitemap.xml\n`
    : "User-agent: *\nDisallow: /\n",
);
const sitemapPath = path.join(output, "sitemap.xml");
if (indexingEnabled) {
  await writeFile(
    sitemapPath,
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${indexableRoutes.map((route) => `<url><loc>${publicUrl}${route}</loc></url>`).join("")}</urlset>\n`,
  );
} else {
  await rm(sitemapPath, { force: true });
}
await build({
  entryPoints: [path.join(source, "assets", "js", "app.js")],
  outfile: path.join(output, "assets", "js", "app.js"),
  bundle: true,
  minify: true,
  sourcemap: false,
  format: "esm",
  target: ["es2022"],
  legalComments: "none",
});
console.log(`Built static HAIPAC site at ${output} (${mode} mode, base ${basePath}, indexing ${indexingEnabled ? "enabled" : "disabled"})`);
