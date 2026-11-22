import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = path.join(root, "dist");
const basePath = process.env.HAIPAC_BASE_PATH || "/";
if (!basePath.startsWith("/") || !basePath.endsWith("/")) {
  throw new Error("HAIPAC_BASE_PATH must start and end with a slash");
}
const basePrefix = basePath === "/" ? "" : basePath.slice(0, -1);
const siteBaseUrl = new URL(basePath, "https://haipac.local/");
const requiredRoutes = [
  "/",
  "/services/",
  "/suivi/",
  "/a-propos/",
  "/tarifs/",
  "/contact/",
  "/guides/",
  "/blog/",
  "/blog/suivi-colis/",
  "/blog/espace-client/",
  "/blog/tarifs-officiels/",
  "/blog/poids-colis/",
  "/blog/numero-hpl/",
  "/blog/securite-compte/",
  "/faq/",
  "/connexion/",
  "/connexion/terminer/",
  "/compte/",
  "/revendiquer/",
  "/admin/",
  "/operations/",
  "/conditions/",
  "/confidentialite/",
];

async function exists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

async function collectHtml(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await collectHtml(fullPath));
    else if (entry.isFile() && entry.name.endsWith(".html")) files.push(fullPath);
  }
  return files;
}

function localPathFor(url) {
  let pathname = decodeURIComponent(url.pathname);
  if (basePrefix) {
    if (pathname === basePrefix) pathname = "/";
    else if (pathname.startsWith(basePath)) pathname = pathname.slice(basePrefix.length);
    else return null;
  }
  const normalized = path.resolve(output, `.${pathname}`);
  if (normalized !== output && !normalized.startsWith(`${output}${path.sep}`)) {
    throw new Error(`Local URL escapes dist: ${url.pathname}`);
  }
  return normalized;
}

async function resolveLocal(url) {
  const target = localPathFor(url);
  if (!target) return null;
  const choices = url.pathname.endsWith("/")
    ? [path.join(target, "index.html")]
    : [target, `${target}.html`, path.join(target, "index.html")];
  for (const candidate of choices) if (await exists(candidate)) return candidate;
  return null;
}

if (!(await exists(path.join(output, "index.html")))) {
  throw new Error("dist/index.html is missing; run npm run build first");
}

for (const route of requiredRoutes) {
  const target = await resolveLocal(new URL(route.slice(1), siteBaseUrl));
  if (!target) throw new Error(`Required route is missing from the static build: ${route}`);
}

const files = await collectHtml(output);
const htmlByFile = new Map();
for (const file of files) {
  const html = await readFile(file, "utf8");
  htmlByFile.set(path.resolve(file), html);
  if (!/<html\b[^>]*\blang=["']fr["']/i.test(html)) throw new Error(`Missing French document language: ${path.relative(output, file)}`);
  if (!/<title>[^<]+<\/title>/i.test(html)) throw new Error(`Missing page title: ${path.relative(output, file)}`);
  if (html.includes("%%HAIPAC_BASE_PATH%%")) throw new Error(`Unresolved base path token: ${path.relative(output, file)}`);
}

const failures = [];
for (const [file, html] of htmlByFile) {
  const baseHref = html.match(/<base\b[^>]*\bhref=["']([^"']*)["']/i)?.[1];
  const documentUrl = new URL(path.relative(output, file).split(path.sep).join("/"), siteBaseUrl);
  const baseUrl = baseHref ? new URL(baseHref, documentUrl) : documentUrl;
  const hasMainContent = /<main\b[^>]*\bid=["']main-content["']/i.test(html);
  const skipLink = html.match(/<a\b(?=[^>]*\bclass=["'][^"']*\bskip-link\b[^"']*["'])[^>]*>/i)?.[0];
  if (hasMainContent && !skipLink) {
    failures.push(`${path.relative(output, file)}: main content has no skip-navigation link`);
  }
  if (skipLink) {
    const skipHref = skipLink.match(/\bhref=["']([^"']*)["']/i)?.[1];
    if (!skipHref) {
      failures.push(`${path.relative(output, file)}: skip-navigation link has no destination`);
    } else {
      const skipTarget = await resolveLocal(new URL(skipHref, baseUrl));
      if (!skipTarget || path.resolve(skipTarget) !== path.resolve(file)) {
        failures.push(`${path.relative(output, file)}: skip-navigation link must target this page, not ${skipHref}`);
      }
    }
  }
  for (const tag of html.matchAll(/<(a|area|link|script|img|source)\b[^>]*>/gi)) {
    const tagText = tag[0];
    const attribute = /<(?:a|area)\b/i.test(tagText) ? "href" : /<(?:link)\b/i.test(tagText) ? "href" : "src";
    const raw = tagText.match(new RegExp(`\\b${attribute}=["']([^"']*)["']`, "i"))?.[1];
    if (raw == null || !raw.trim()) continue;
    if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(raw)) continue;

    let resolved;
    try {
      resolved = new URL(raw, baseUrl);
    } catch {
      failures.push(`${path.relative(output, file)}: malformed ${attribute} ${raw}`);
      continue;
    }
    if (resolved.origin !== "https://haipac.local") continue;
    const target = await resolveLocal(resolved);
    if (!target) {
      failures.push(`${path.relative(output, file)}: missing ${attribute} target ${raw}`);
      continue;
    }
    if (resolved.hash && /^(?:a|area)$/i.test(tag[1])) {
      const targetHtml = htmlByFile.get(path.resolve(target)) ?? await readFile(target, "utf8");
      const id = decodeURIComponent(resolved.hash.slice(1));
      const escapedId = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      if (!new RegExp(`\\bid=["']${escapedId}["']`, "i").test(targetHtml)) {
        failures.push(`${path.relative(output, file)}: missing anchor ${resolved.hash} in ${path.relative(output, target)}`);
      }
    }
  }
}

if (failures.length) throw new Error(`Static-site validation failed:\n- ${failures.join("\n- ")}`);
console.log(`Static site validated: ${requiredRoutes.length} required routes, ${files.length} HTML documents, and all local links/assets resolve (base ${basePath}).`);
