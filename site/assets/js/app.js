import { getApp, getApps, initializeApp } from "firebase/app";
import {
  connectAuthEmulator,
  getAuth,
  isSignInWithEmailLink,
  onAuthStateChanged,
  sendSignInLinkToEmail,
  signInWithEmailLink,
  signOut,
} from "firebase/auth";
import { firebaseConfig } from "./firebase-config.js";

const runtime = window.HAIPAC_CONFIG ?? {};
const appBase = document.querySelector("base")?.href ?? `${window.location.origin}/`;
const API_BASE_URL = runtime.apiBaseUrl || "/api/";
const CLAIM_TOKEN_KEY = "haipacClaimToken";

function appUrl(path = "") {
  return new URL(path, appBase).toString();
}

function authClient() {
  if (firebaseConfig.projectId !== "haipac-7e19d") {
    throw new Error("FIREBASE_PROJECT_MISMATCH");
  }
  const app = getApps().some((candidate) => candidate.name === "haipac")
    ? getApp("haipac")
    : initializeApp(firebaseConfig, "haipac");
  const auth = getAuth(app);
  if (runtime.mode !== "production" && runtime.authEmulatorUrl && !auth.emulatorConfig) {
    connectAuthEmulator(auth, runtime.authEmulatorUrl, { disableWarnings: true });
  }
  auth.languageCode = "fr";
  return auth;
}

function apiUrl(path) {
  const base = new URL(API_BASE_URL.endsWith("/") ? API_BASE_URL : `${API_BASE_URL}/`, window.location.origin);
  return new URL(path.replace(/^\/+/, ""), base);
}

async function request(path, { user, ...init } = {}) {
  const headers = new Headers(init.headers ?? {});
  if (user) headers.set("Authorization", `Bearer ${await user.getIdToken()}`);
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const response = await fetch(apiUrl(path), { ...init, headers, cache: "no-store" });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(typeof data.error === "string" ? data.error : "REQUEST_FAILED");
    error.status = response.status;
    throw error;
  }
  return data;
}

function element(id) {
  return document.getElementById(id);
}

function setStatus(target, message, kind = "") {
  if (!target) return;
  target.textContent = message;
  target.classList.remove("is-error", "is-success");
  if (kind) target.classList.add(kind);
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[char]);
}

function formatDate(value, withTime = false) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("fr-HT", withTime
    ? { dateStyle: "medium", timeStyle: "short" }
    : { dateStyle: "medium" }).format(date);
}

function renderLegalBody(target, source) {
  target.replaceChildren();
  const paragraphs = [];
  let list = null;
  const flushParagraph = () => {
    if (!paragraphs.length) return;
    const paragraph = document.createElement("p");
    paragraph.textContent = paragraphs.join(" ");
    target.append(paragraph);
    paragraphs.length = 0;
  };
  const flushList = () => { list = null; };

  for (const rawLine of String(source ?? "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) {
      flushParagraph();
      flushList();
      continue;
    }
    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      flushParagraph();
      flushList();
      const headingElement = document.createElement(heading[1].length === 3 ? "h3" : "h2");
      headingElement.textContent = heading[2];
      target.append(headingElement);
      continue;
    }
    const item = line.match(/^[-*]\s+(.+)$/);
    if (item) {
      flushParagraph();
      if (!list) {
        list = document.createElement("ul");
        target.append(list);
      }
      const listItem = document.createElement("li");
      listItem.textContent = item[1];
      list.append(listItem);
      continue;
    }
    flushList();
    paragraphs.push(line);
  }
  flushParagraph();
}

async function initLegal() {
  const documentId = document.documentElement.dataset.legalKey;
  if (!documentId) return;
  try {
    const result = await request(`/v1/legal-content/${encodeURIComponent(documentId)}`);
    const legalDocument = result.document;
    if (!legalDocument) return;
    const title = element("legal-document-title");
    const status = element("legal-document-status");
    const placeholder = element("legal-document-placeholder");
    const body = element("legal-document-body");
    if (!title || !status || !placeholder || !body) return;

    title.textContent = legalDocument.title;
    status.textContent = `Version ${legalDocument.version} · publiée le ${formatDate(legalDocument.publishedAt)}`;
    placeholder.hidden = true;
    body.hidden = false;
    renderLegalBody(body, legalDocument.body);
    document.title = `${legalDocument.title} | HAIPAC Logistics`;
    const robots = document.querySelector('meta[name="robots"]');
    if (runtime.indexingEnabled && robots) robots.content = "index,follow";
    const description = document.querySelector('meta[name="description"]');
    if (description) description.content = String(legalDocument.body).replace(/[#*\n-]+/g, " ").trim().slice(0, 180);
  } catch {
    // Keep the clearly labeled local draft if the public API is unavailable.
  }
}

function observeSignedInUser(onUser) {
  let auth;
  try {
    auth = authClient();
  } catch {
    onUser(null, new Error("FIREBASE_CLIENT_CONFIG_MISSING"));
    return () => {};
  }
  return onAuthStateChanged(auth, (user) => onUser(user, null), () => onUser(null, new Error("AUTH_STATE_UNAVAILABLE")));
}

function redirectToSignIn() {
  window.location.replace(appUrl("connexion/"));
}

function requestErrorMessage(error, fallback) {
  if (error?.message === "AUTH_REQUIRED" || error?.message === "AUTH_INVALID") return "Votre session a expiré. Reconnectez-vous.";
  if (error?.message === "ADMIN_REQUIRED" || error?.message === "OPERATIONS_REQUIRED") return "Votre compte n’a pas encore le rôle nécessaire.";
  if (error?.message === "PRODUCTION_NOT_READY" || error?.message === "LEGAL_CONTENT_NOT_APPROVED" || error?.message === "OPERATIONS_NOT_READY") return "Ce service n’est pas encore ouvert. HAIPAC doit terminer sa configuration.";
  if (error?.message === "RATE_CARD_NOT_YET_EFFECTIVE") return "La date d’effet de ce barème n’est pas encore arrivée.";
  if (error?.message === "RATE_CARD_EXPIRED") return "Ce barème a dépassé sa date de validité.";
  return fallback;
}

function initHome() {
  const year = document.querySelector("[data-current-year]");
  if (year) year.textContent = String(new Date().getFullYear());
  const form = element("tracking-form");
  if (!form) return;
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const field = element("tracking-number");
    const button = form.querySelector("button[type=submit]");
    const status = element("tracking-message");
    const resultArea = element("tracking-result");
    const trackingNumber = field.value.trim().toUpperCase();
    resultArea.replaceChildren();
    if (!/^HPL[0-9]{10}$/.test(trackingNumber)) {
      setStatus(status, "Vérifiez le numéro : HPL suivi de 10 chiffres.");
      field.focus();
      return;
    }
    button.disabled = true;
    button.textContent = "Recherche…";
    setStatus(status, "Recherche du colis…");
    try {
      const payload = await request(`/v1/tracking/${encodeURIComponent(trackingNumber)}`);
      setStatus(status, "Suivi trouvé.", "is-success");
      const events = Array.isArray(payload.events) ? payload.events : [];
      resultArea.innerHTML = `<div class="tracking-result-block"><div class="tracking-result"><span aria-hidden="true">●</span><strong>${escapeHtml(payload.status)}</strong></div><ol class="public-tracking-events">${events.map((item) => `<li><span class="event-marker" aria-hidden="true"></span><div><strong>${escapeHtml(item.status)}</strong>${item.location ? `<small>${escapeHtml(item.location)}</small>` : ""}${item.message ? `<p>${escapeHtml(item.message)}</p>` : ""}${item.createdAt ? `<time datetime="${escapeHtml(item.createdAt)}">${escapeHtml(formatDate(item.createdAt, true))}</time>` : ""}</div></li>`).join("")}</ol>${!events.length && payload.updatedAt ? `<p class="tracking-help">Dernière mise à jour : ${escapeHtml(formatDate(payload.updatedAt, true))}</p>` : ""}</div>`;
    } catch (error) {
      setStatus(status, error.status === 404
        ? "Aucun suivi ne correspond à ce numéro."
        : "Le suivi est temporairement indisponible. Réessayez.");
    } finally {
      button.disabled = false;
      button.textContent = "Rechercher";
    }
  });
}

function initSignIn() {
  const form = element("signin-form");
  if (!form) return;
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const email = element("signin-email").value.trim();
    const button = form.querySelector("button[type=submit]");
    const status = element("signin-status");
    button.disabled = true;
    button.textContent = "Envoi en cours…";
    setStatus(status, "");
    try {
      const auth = authClient();
      await sendSignInLinkToEmail(auth, email, {
        url: appUrl("connexion/terminer/"),
        handleCodeInApp: true,
      });
      window.localStorage.setItem("haipacEmailForSignIn", email);
      setStatus(status, "Le lien de connexion a été envoyé. Consultez votre boîte e-mail.", "is-success");
    } catch {
      setStatus(status, "Impossible d’envoyer le lien. Vérifiez la configuration Firebase, l’adresse et réessayez.");
    } finally {
      button.disabled = false;
      button.textContent = "Recevoir mon lien";
    }
  });
}

async function finishEmailSignIn(email, status) {
  const auth = authClient();
  const credential = await signInWithEmailLink(auth, email.trim(), window.location.href);
  window.localStorage.removeItem("haipacEmailForSignIn");
  await request("/v1/account", { method: "POST", user: credential.user });
  const claimToken = window.localStorage.getItem(CLAIM_TOKEN_KEY);
  if (claimToken) {
    await request("/v1/claims", { method: "POST", user: credential.user, body: JSON.stringify({ token: claimToken }) });
    window.localStorage.removeItem(CLAIM_TOKEN_KEY);
  }
  setStatus(status, "Connexion réussie. Ouverture de votre espace…", "is-success");
  window.location.replace(appUrl(claimToken ? "compte/" : "compte/"));
}

function initFinishSignIn() {
  const status = element("finish-status");
  const form = element("finish-form");
  const emailInput = element("finish-email");
  const retry = element("finish-new-link");
  const savedEmail = window.localStorage.getItem("haipacEmailForSignIn") ?? "";
  emailInput.value = savedEmail;
  const showEmailForm = () => { form.hidden = false; };
  if (!isSignInWithEmailLink(authClient(), window.location.href)) {
    setStatus(status, "Ce lien de connexion n’est pas valide ou a déjà été utilisé.");
    retry.hidden = false;
  } else if (!savedEmail) {
    setStatus(status, "Saisissez l’adresse e-mail à laquelle ce lien a été envoyé.");
    showEmailForm();
  } else {
    void finishEmailSignIn(savedEmail, status).catch(() => {
      setStatus(status, "Le lien a expiré ou l’adresse ne correspond pas. Demandez un nouveau lien.");
      retry.hidden = false;
    });
  }
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = form.querySelector("button[type=submit]");
    button.disabled = true;
    setStatus(status, "Connexion en cours…");
    try {
      await finishEmailSignIn(emailInput.value, status);
    } catch {
      setStatus(status, "Le lien a expiré ou l’adresse ne correspond pas. Demandez un nouveau lien.");
      retry.hidden = false;
    } finally {
      button.disabled = false;
    }
  });
}

function initClaim() {
  const status = element("claim-status");
  const form = element("claim-form");
  const login = element("claim-login");
  let token = window.localStorage.getItem(CLAIM_TOKEN_KEY) ?? "";
  const url = new URL(window.location.href);
  const queryToken = url.searchParams.get("token");
  if (queryToken && /^[A-Za-z0-9_-]{40,60}$/.test(queryToken)) {
    token = queryToken;
    window.localStorage.setItem(CLAIM_TOKEN_KEY, token);
    window.history.replaceState(null, "", appUrl("revendiquer/"));
  }
  if (!token) {
    setStatus(status, "Le lien de rattachement est absent. Ouvrez le lien reçu par e-mail.");
    return;
  }
  const submitEmail = async (email) => {
    const button = form.querySelector("button[type=submit]");
    button.disabled = true;
    try {
      const auth = authClient();
      await sendSignInLinkToEmail(auth, email.trim(), { url: appUrl("connexion/terminer/"), handleCodeInApp: true });
      window.localStorage.setItem("haipacEmailForSignIn", email.trim());
      setStatus(status, "Lien de connexion envoyé. Ouvrez-le sur cet appareil pour terminer le rattachement.", "is-success");
    } catch {
      setStatus(status, "Impossible d’envoyer le lien. Vérifiez l’adresse destinataire et réessayez.");
    } finally {
      button.disabled = false;
    }
  };
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    void submitEmail(element("claim-email").value);
  });
  observeSignedInUser((user, error) => {
    if (error) {
      setStatus(status, "La connexion n’est pas encore configurée pour cet environnement.");
      return;
    }
    if (!user) {
      setStatus(status, "Connectez-vous avec l’adresse e-mail destinataire pour rattacher ce colis.");
      form.hidden = false;
      login.hidden = false;
      return;
    }
    form.hidden = true;
    setStatus(status, "Rattachement du colis à votre compte…");
    void request("/v1/claims", { method: "POST", user, body: JSON.stringify({ token }) })
      .then(() => {
        window.localStorage.removeItem(CLAIM_TOKEN_KEY);
        setStatus(status, "Colis rattaché. Ouverture de votre espace…", "is-success");
        window.location.replace(appUrl("compte/"));
      })
      .catch(() => setStatus(status, "Ce lien a expiré, a déjà été utilisé ou l’adresse de connexion est différente de celle du destinataire."));
  });
}

function initAccount() {
  const notice = element("account-notice");
  let currentUser = null;
  let communes = [];
  const renderAccount = async (user) => {
    currentUser = user;
    try {
      const [accountData, addressData, communeData] = await Promise.all([
        request("/v1/account", { user }),
        request("/v1/account/addresses", { user }),
        request("/v1/communes"),
      ]);
      const account = accountData.account ?? {};
      element("account-title").textContent = `Bonjour${account.displayName ? `, ${account.displayName}` : ""}.`;
      element("account-email").textContent = account.email ?? "";
      element("case-number").textContent = account.caseNumber ?? "—";
      communes = Array.isArray(communeData.communes) ? communeData.communes : [];
      const shipments = Array.isArray(accountData.shipments) ? accountData.shipments : [];
      element("account-shipments").innerHTML = shipments.length
        ? `<div class="account-list">${shipments.map((item) => `<article class="account-list-item"><div><strong>${escapeHtml(item.trackingNumber)}</strong><span>${escapeHtml(formatDate(item.createdAt))}</span></div><span class="shipment-status">${escapeHtml(item.status)}</span></article>`).join("")}</div>`
        : `<p class="account-empty">Aucun colis n’est encore associé à votre compte. Un achat Smart Cut peut être rattaché à votre espace avec son lien sécurisé reçu par e-mail.</p>`;
      const addresses = Array.isArray(addressData.addresses) ? addressData.addresses : [];
      element("account-addresses").innerHTML = addresses.map((address) => {
        const commune = communes.find((item) => item.code === address.communeCode);
        return `<article class="account-list-item"><div><strong>${escapeHtml(address.label)}</strong><span>${escapeHtml(address.addressLine)} · ${escapeHtml(commune?.name ?? address.communeCode)}${address.department ? `, ${escapeHtml(address.department)}` : ""}</span></div></article>`;
      }).join("");
      const departments = [...new Set(communes.map((item) => item.departmentName))].sort((a, b) => a.localeCompare(b, "fr"));
      element("address-department").innerHTML = `<option value="">Choisir un département</option>${departments.map((name) => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join("")}`;
      updateCommuneOptions();
      setStatus(notice, "Votre espace est à jour.", "is-success");
    } catch (error) {
      setStatus(notice, requestErrorMessage(error, "Votre espace est temporairement indisponible. Réessayez dans un instant."), "is-error");
    }
  };
  const updateCommuneOptions = () => {
    const department = element("address-department").value;
    const options = communes.filter((item) => item.departmentName === department);
    element("address-commune").disabled = !options.length;
    element("address-commune").innerHTML = `<option value="">${department ? "Choisir une commune" : "Choisir d’abord un département"}</option>${options.map((item) => `<option value="${escapeHtml(item.code)}">${escapeHtml(item.name)}</option>`).join("")}`;
  };
  element("address-department").addEventListener("change", updateCommuneOptions);
  element("address-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!currentUser) return;
    const form = event.currentTarget;
    const button = form.querySelector("button[type=submit]");
    const formData = new FormData(form);
    const body = Object.fromEntries(formData.entries());
    button.disabled = true;
    setStatus(notice, "Enregistrement de l’adresse…");
    try {
      await request("/v1/account/addresses", { method: "POST", user: currentUser, body: JSON.stringify(body) });
      form.reset();
      updateCommuneOptions();
      await renderAccount(currentUser);
    } catch (error) {
      setStatus(notice, requestErrorMessage(error, "Adresse invalide ou service temporairement indisponible."), "is-error");
    } finally {
      button.disabled = false;
    }
  });
  element("signout-button").addEventListener("click", async () => {
    try {
      await signOut(authClient());
      window.location.replace(appUrl(""));
    } catch {
      setStatus(notice, "Impossible de fermer la session pour le moment.", "is-error");
    }
  });
  observeSignedInUser((user, error) => {
    if (error) {
      setStatus(notice, "La connexion n’est pas encore configurée pour cet environnement.", "is-error");
      return;
    }
    if (!user) return redirectToSignIn();
    void renderAccount(user);
  });
}

const STATUS_LABELS = {
  registered: "Enregistré", received: "Reçu", in_transit: "En transit",
  out_for_delivery: "En cours de livraison", delivered: "Livré", exception: "Incident",
  returned: "Retourné", cancelled: "Annulé",
};
const OPERATION_STATUSES = ["registered", "received", "in_transit", "out_for_delivery", "exception", "returned", "cancelled"];

function initOperations() {
  const notice = element("operations-notice");
  const list = element("operations-list");
  const filter = element("operations-filter");
  let currentUser = null;
  let busy = false;
  async function load(status = filter.value) {
    if (!currentUser) return;
    setStatus(notice, "Chargement des colis…");
    try {
      const query = status === "open" ? "" : `?status=${encodeURIComponent(status)}`;
      const result = await request(`/v1/operations/shipments${query}`, { user: currentUser });
      const shipments = Array.isArray(result.shipments) ? result.shipments : [];
      list.innerHTML = shipments.map((shipment) => {
        const number = escapeHtml(shipment.trackingNumber);
        const statusOptions = OPERATION_STATUSES.filter((item) => item !== shipment.status)
          .map((item) => `<option value="${item}">${STATUS_LABELS[item]}</option>`).join("");
        const address = [shipment.locality, shipment.addressLine].filter(Boolean).map(escapeHtml).join(" — ");
        return `<article class="operation-card" data-shipment="${number}"><div class="operation-card-top"><div><strong>${number}</strong><span>${escapeHtml(formatDate(shipment.createdAt, true))}</span></div><span class="shipment-status">${escapeHtml(STATUS_LABELS[shipment.status] ?? shipment.status)}</span></div><div class="operation-address"><strong>${escapeHtml(shipment.recipientName)}</strong><span>${escapeHtml(shipment.recipientPhone)}</span><span>${escapeHtml(shipment.destinationName)} · ${escapeHtml(shipment.destinationDepartmentCode)}</span><span>${address}</span>${shipment.directions ? `<span>${escapeHtml(shipment.directions)}</span>` : ""}</div>${shipment.status === "out_for_delivery" ? `<div class="delivery-confirm"><label>Code de remise<input data-delivery-code inputmode="numeric" pattern="[0-9]{6}" maxlength="6" autocomplete="one-time-code"></label><button class="button button-primary" data-action="deliver">Confirmer la remise</button><button class="button button-outline" data-action="incident">Signaler un incident</button></div>` : `<div class="operation-actions"><label>Prochain statut<select data-next-status><option value="" disabled selected>Choisir une action</option>${statusOptions}</select></label><button class="button button-primary" data-action="update">Mettre à jour</button></div>`}</article>`;
      }).join("");
      setStatus(notice, shipments.length ? `${shipments.length} colis affiché${shipments.length > 1 ? "s" : ""}.` : "Aucun colis dans cette vue.", "is-success");
    } catch (error) {
      setStatus(notice, requestErrorMessage(error, "Impossible de charger les colis."), "is-error");
    }
  }
  async function changeStatus(card, status) {
    const trackingNumber = card.dataset.shipment;
    const previousStatus = card.querySelector(".shipment-status")?.textContent;
    if (!trackingNumber || !status || busy) return;
    busy = true;
    try {
      await request(`/v1/operations/shipments/${encodeURIComponent(trackingNumber)}`, {
        method: "PATCH", user: currentUser, body: JSON.stringify({ expectedStatus: Object.keys(STATUS_LABELS).find((key) => STATUS_LABELS[key] === previousStatus) ?? previousStatus, status }),
      });
      setStatus(notice, status === "out_for_delivery" ? "Colis prêt à livrer. Le code de remise est ajouté à la file d’envoi par e-mail." : "Statut mis à jour.", "is-success");
      await load();
    } catch (error) {
      setStatus(notice, requestErrorMessage(error, "Mise à jour refusée. Vérifiez le statut courant et la configuration des notifications."), "is-error");
    } finally { busy = false; }
  }
  list.addEventListener("click", async (event) => {
    const button = event.target.closest("button[data-action]");
    if (!button || !currentUser) return;
    const card = button.closest("[data-shipment]");
    if (!card) return;
    if (button.dataset.action === "update") return changeStatus(card, card.querySelector("[data-next-status]").value);
    if (button.dataset.action === "incident") return changeStatus(card, "exception");
    if (button.dataset.action === "deliver") {
      busy = true;
      try {
        await request(`/v1/operations/shipments/${encodeURIComponent(card.dataset.shipment)}/deliver`, {
          method: "POST", user: currentUser, body: JSON.stringify({ code: card.querySelector("[data-delivery-code]").value }),
        });
        setStatus(notice, "Remise confirmée.", "is-success");
        await load();
      } catch (error) {
        setStatus(notice, requestErrorMessage(error, "Code invalide, expiré ou colis non prêt à la livraison."), "is-error");
      } finally { busy = false; }
    }
  });
  filter.addEventListener("change", () => void load());
  element("operations-refresh").addEventListener("click", () => void load());
  observeSignedInUser((user, error) => {
    if (error) return setStatus(notice, "La connexion n’est pas configurée.", "is-error");
    if (!user) return redirectToSignIn();
    currentUser = user;
    void load();
  });
}

function normalizeDepartment(value) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
const DEPARTMENT_CODES = {
  artibonite: "AR", centre: "CE", "grand anse": "GA", nippes: "NI", nord: "NO",
  "nord est": "NE", "nord ouest": "NW", ouest: "OU", sud: "SU", "sud est": "SE",
};
function getDepartmentCode(value) { return DEPARTMENT_CODES[normalizeDepartment(value)] ?? ""; }
function getCommuneCode(departmentName, communeName) {
  const code = getDepartmentCode(departmentName);
  const slug = communeName.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return code && slug ? `${code}-${slug}` : "";
}

function initAdmin() {
  const notice = element("admin-notice");
  const content = element("admin-content");
  let currentUser = null;
  let overview = null;
  let busy = false;
  let legalDocuments = {};
  let selectedLegalDocument = "conditions";
  let legalDraftDirty = false;
  let adminPolicies = {};
  let selectedAdminPolicy = "data-retention";
  let adminPolicyDraftDirty = false;
  let selectedRateDraftVersion = null;
  let activeRateVersion = null;
  let rateDraftDirty = false;
  const rateZones = ["local", "regional", "national"];
  const maxRateTiersPerZone = 500;
  const rateZoneNames = { local: "locale", regional: "régionale", national: "nationale" };
  const emptyRateDraft = { version: "", status: "draft", currency: "HTG", tierBasis: "rounded_billable_kg", volumetricDivisor: 6000, minimumBillableKg: 1, maxAutoQuoteKg: 100, zones: { local: [], regional: [], national: [] } };
  const envLabels = {
    rateCardEffective: "Barème dans sa période de validité",
    firebaseAdminIdentity: "Identité Firebase Admin / OIDC", smartCutSignature: "Signature Smart Cut → HAIPAC",
    secureClaimEmail: "Chiffrement des liens de réclamation", deliveryCodeSecret: "Secret des codes de remise",
    trackingRateLimit: "Protection du suivi public", emailProvider: "E-mail transactionnel",
    cronSecret: "Traitement sécurisé de la file e-mail", legalContentApproved: "Validation juridique avant ouverture",
    conditionsPublished: "Conditions publiées", privacyPublished: "Confidentialité publiée",
    retentionPolicyPublished: "Politique de conservation versionnée",
    operationsProceduresPublished: "Procédures opérationnelles versionnées",
    operationsReady: "Procédures opérationnelles validées", publicUrlConfigured: "URL publique HTTPS configurée",
  };
  function haipacToday() {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Port-au-Prince", year: "numeric", month: "2-digit", day: "2-digit",
    }).formatToParts(new Date());
    const part = (type) => parts.find((item) => item.type === type)?.value ?? "";
    return `${part("year")}-${part("month")}-${part("day")}`;
  }
  function isValidRateDate(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  }
  function setRateDraftStatus(message, type = "") {
    const status = element("rate-draft-status");
    status.textContent = message;
    status.className = `account-notice${type ? ` ${type}` : ""}`;
  }
  function rateInputNumber(value, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
    if (value === "") return null;
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) && parsed >= min && parsed <= max ? parsed : null;
  }
  function renderRateTier(zone, tier = {}, index = 0) {
    const method = tier.method === "per_kg" ? "per_kg" : "first_kg_plus_additional";
    const min = rateInputNumber(String(tier.minBillableKg ?? ""), { min: 1 });
    const max = tier.maxBillableKg === null || tier.maxBillableKg === undefined
      ? "" : rateInputNumber(String(tier.maxBillableKg), { min: 1 });
    const firstKg = rateInputNumber(String(tier.firstKgHtg ?? ""));
    const additionalKg = rateInputNumber(String(tier.additionalKgHtg ?? ""));
    const pricePerKg = rateInputNumber(String(tier.pricePerKgHtg ?? ""));
    return `<fieldset class="rate-tier-row" data-rate-tier data-zone="${zone}"><legend>Tranche <span data-rate-tier-number>${index + 1}</span></legend><div class="rate-tier-limits"><label>À partir de (kg)<input data-rate-min type="number" min="1" step="1" value="${min ?? ""}" required></label><label>Jusqu’à (kg)<input data-rate-max type="number" min="1" step="1" value="${max ?? ""}" placeholder="Sans limite" aria-label="Limite maximale en kilogrammes; vide signifie sans limite"></label></div><label class="rate-method-label">Calcul de cette tranche<select data-rate-method><option value="first_kg_plus_additional"${method === "first_kg_plus_additional" ? " selected" : ""}>Prix du 1er kg + chaque kg additionnel</option><option value="per_kg"${method === "per_kg" ? " selected" : ""}>Prix fixe par kg</option></select></label><div class="rate-tier-prices" data-rate-first-prices${method === "per_kg" ? " hidden" : ""}><label>Prix du premier kg (HTG)<input data-rate-first-kg type="number" min="0" step="1" value="${firstKg ?? ""}"${method !== "per_kg" ? " required" : ""}></label><label>Prix par kg additionnel (HTG)<input data-rate-additional-kg type="number" min="0" step="1" value="${additionalKg ?? ""}"${method !== "per_kg" ? " required" : ""}></label></div><div class="rate-tier-prices" data-rate-per-kg-price${method !== "per_kg" ? " hidden" : ""}><label>Prix par kg (HTG)<input data-rate-price-per-kg type="number" min="0" step="1" value="${pricePerKg ?? ""}"${method === "per_kg" ? " required" : ""}></label></div><button class="rate-tier-remove" type="button" data-remove-rate-tier aria-label="Supprimer la tranche ${index + 1} de la zone ${rateZoneNames[zone]}">Supprimer cette tranche</button></fieldset>`;
  }
  function renderRateEditor(card) {
    element("rate-version").value = card.version ?? "";
    element("rate-max-auto-quote").value = String(card.maxAutoQuoteKg ?? 100);
    for (const zone of rateZones) {
      const tiers = Array.isArray(card.zones?.[zone]) ? card.zones[zone] : [];
      const list = element(`rate-tiers-${zone}`);
      list.innerHTML = tiers.length
        ? tiers.slice(0, maxRateTiersPerZone).map((tier, index) => renderRateTier(zone, tier, index)).join("")
        : `<p class="rate-zone-empty">Ajoutez au moins une tranche pour compléter cette zone.</p>`;
      element("admin-rates").querySelector(`[data-add-rate-tier="${zone}"]`).disabled = tiers.length >= maxRateTiersPerZone;
    }
  }
  function addRateTier(zone, tier = {}) {
    const list = element(`rate-tiers-${zone}`);
    const count = list.querySelectorAll("[data-rate-tier]").length;
    if (count >= maxRateTiersPerZone) return setRateDraftStatus(`Une zone peut contenir au maximum ${maxRateTiersPerZone} tranches.`, "is-error");
    list.querySelector(".rate-zone-empty")?.remove();
    list.insertAdjacentHTML("beforeend", renderRateTier(zone, tier, count));
    element("admin-rates").querySelector(`[data-add-rate-tier="${zone}"]`).disabled = count + 1 >= maxRateTiersPerZone;
    list.querySelector("[data-rate-tier]:last-child [data-rate-min]")?.focus();
    markRateDraftDirty();
  }
  function markRateDraftDirty() {
    rateDraftDirty = true;
    element("activate-rate").disabled = true;
    setRateDraftStatus("Le brouillon a été modifié. Enregistrez ces changements avant de pouvoir l’activer.");
  }
  function rateCoverageIssue(card) {
    for (const zone of rateZones) {
      const tiers = [...card.zones[zone]].sort((left, right) => left.minBillableKg - right.minBillableKg);
      if (tiers[0]?.minBillableKg !== 1) return `La zone ${rateZoneNames[zone]} doit commencer à 1 kg.`;
      for (let index = 0; index < tiers.length; index += 1) {
        const tier = tiers[index];
        const next = tiers[index + 1];
        if (tier.maxBillableKg !== null && tier.maxBillableKg < tier.minBillableKg) return `La tranche ${index + 1} de la zone ${rateZoneNames[zone]} a une limite invalide.`;
        if (tier.maxBillableKg === null && next) return `La tranche sans limite doit être la dernière dans la zone ${rateZoneNames[zone]}.`;
        if (tier.maxBillableKg !== null && next && next.minBillableKg !== tier.maxBillableKg + 1) return `Les tranches de la zone ${rateZoneNames[zone]} doivent se suivre sans trou ni chevauchement.`;
      }
      const last = tiers.at(-1);
      if (last.maxBillableKg !== null && last.maxBillableKg < card.maxAutoQuoteKg) return `La zone ${rateZoneNames[zone]} doit couvrir le plafond de ${card.maxAutoQuoteKg} kg, ou utiliser une dernière tranche sans limite.`;
    }
    return null;
  }
  function readRateDraft() {
    const version = element("rate-version").value.trim();
    if (!/^[a-zA-Z0-9._-]{1,50}$/.test(version)) {
      setRateDraftStatus("Saisissez un identifiant de version de 1 à 50 caractères (lettres, chiffres, point, tiret ou souligné).", "is-error");
      return null;
    }
    if (version === activeRateVersion) {
      setRateDraftStatus("La version active ne peut pas être modifiée. Choisissez un nouvel identifiant de version.", "is-error");
      return null;
    }
    const effectiveFrom = element("rate-effective-from").value;
    const effectiveUntil = element("rate-effective-until").value;
    if (!isValidRateDate(effectiveFrom)) {
      setRateDraftStatus("Choisissez une date d’effet valide.", "is-error");
      return null;
    }
    if (effectiveUntil && (!isValidRateDate(effectiveUntil) || effectiveUntil < effectiveFrom)) {
      setRateDraftStatus("La date de fin doit être valide et égale ou postérieure à la date d’effet.", "is-error");
      return null;
    }
    const maxAutoQuoteKg = rateInputNumber(element("rate-max-auto-quote").value, { min: 1, max: 1000 });
    if (maxAutoQuoteKg === null) {
      setRateDraftStatus("Le plafond des devis automatiques doit être un nombre entier entre 1 et 1 000 kg.", "is-error");
      return null;
    }
    const zones = { local: [], regional: [], national: [] };
    for (const zone of rateZones) {
      const rows = [...element(`rate-tiers-${zone}`).querySelectorAll("[data-rate-tier]")];
      if (!rows.length) {
        setRateDraftStatus(`Ajoutez au moins une tranche dans la zone ${rateZoneNames[zone]}.`, "is-error");
        return null;
      }
      if (rows.length > maxRateTiersPerZone) {
        setRateDraftStatus(`La zone ${rateZoneNames[zone]} dépasse la limite de ${maxRateTiersPerZone} tranches.`, "is-error");
        return null;
      }
      for (const [index, row] of rows.entries()) {
        const minBillableKg = rateInputNumber(row.querySelector("[data-rate-min]").value, { min: 1 });
        const maxValue = row.querySelector("[data-rate-max]").value;
        const maxBillableKg = maxValue === "" ? null : rateInputNumber(maxValue, { min: 1 });
        const method = row.querySelector("[data-rate-method]").value;
        if (minBillableKg === null || (maxValue !== "" && maxBillableKg === null) || (maxBillableKg !== null && maxBillableKg < minBillableKg)) {
          setRateDraftStatus(`Vérifiez les limites de la tranche ${index + 1} dans la zone ${rateZoneNames[zone]}.`, "is-error");
          return null;
        }
        if (method === "per_kg") {
          const pricePerKgHtg = rateInputNumber(row.querySelector("[data-rate-price-per-kg]").value);
          if (pricePerKgHtg === null) {
            setRateDraftStatus(`Saisissez un prix par kilogramme entier et positif ou nul pour la tranche ${index + 1} (${rateZoneNames[zone]}).`, "is-error");
            return null;
          }
          zones[zone].push({ minBillableKg, maxBillableKg, method, pricePerKgHtg });
        } else {
          const firstKgHtg = rateInputNumber(row.querySelector("[data-rate-first-kg]").value);
          const additionalKgHtg = rateInputNumber(row.querySelector("[data-rate-additional-kg]").value);
          if (firstKgHtg === null || additionalKgHtg === null) {
            setRateDraftStatus(`Saisissez les deux montants entiers de la tranche ${index + 1} (${rateZoneNames[zone]}).`, "is-error");
            return null;
          }
          zones[zone].push({ minBillableKg, maxBillableKg, method: "first_kg_plus_additional", firstKgHtg, additionalKgHtg });
        }
      }
    }
    const card = {
      version, status: "draft", effectiveFrom, effectiveUntil: effectiveUntil || null,
      currency: "HTG", tierBasis: "rounded_billable_kg", volumetricDivisor: 6000,
      minimumBillableKg: 1, maxAutoQuoteKg, zones,
    };
    return card;
  }
  function rateDateIssue(card) {
    const today = haipacToday();
    if (!card.effectiveFrom || !isValidRateDate(card.effectiveFrom)) return "Choisissez une date d’effet pour ce brouillon.";
    if (today < card.effectiveFrom) return `Ce barème prendra effet le ${card.effectiveFrom}. Il pourra être activé à partir de cette date.`;
    if (card.effectiveUntil && today > card.effectiveUntil) return `Ce barème a expiré le ${card.effectiveUntil} et ne peut pas être activé.`;
    return null;
  }
  async function load() {
    if (!currentUser) return;
    setStatus(notice, "Chargement de la configuration…");
    try {
      const [overviewData, communeData, rateData, originData, legalData, policyData] = await Promise.all([
        request("/v1/admin/overview", { user: currentUser }),
        request("/v1/admin/communes", { user: currentUser }),
        request("/v1/admin/rate-cards", { user: currentUser }),
        request("/v1/admin/dispatch-origin", { user: currentUser }),
        request("/v1/admin/legal-content", { user: currentUser }),
        request("/v1/admin/policies", { user: currentUser }),
      ]);
      overview = overviewData;
      legalDocuments = legalData.documents ?? {};
      adminPolicies = policyData.policies ?? {};
      element("admin-content").hidden = false;
      element("readiness-heading").textContent = overview.productionReady ? "Prêt pour la production" : "Configuration incomplète";
      element("readiness-pill").textContent = overview.productionReady ? "PRÊT" : "BLOQUÉ";
      element("readiness-pill").className = `readiness-pill${overview.productionReady ? " is-ready" : ""}`;
      element("readiness-rate").textContent = overview.activeRateVersion
        ? (overview.rateCardDateError === "RATE_CARD_EXPIRED" ? `Expiré · ${overview.activeRateVersion}`
          : overview.rateCardDateError === "RATE_CARD_NOT_YET_EFFECTIVE" ? `À venir · ${overview.activeRateVersion}`
            : overview.rateCardDateError ? `À vérifier · ${overview.activeRateVersion}` : overview.activeRateVersion)
        : "Aucun";
      element("readiness-communes").textContent = String(overview.activeCommuneCount ?? 0);
      element("readiness-shipments").textContent = String(overview.openShipmentCount ?? 0);
      element("readiness-emails").textContent = String(overview.pendingEmailCount ?? 0);
      element("readiness-list").innerHTML = Object.entries(overview.environment ?? {}).map(([key, ready]) => `<li><span class="readiness-check${ready ? " is-ready" : ""}">${ready ? "✓" : "!"}</span>${escapeHtml(envLabels[key] ?? key)}<strong>${ready ? "Configuré" : "À configurer"}</strong></li>`).join("");
      element("origin-code").value = String(originData.originCommuneCode ?? "");
      const communes = Array.isArray(communeData.communes) ? communeData.communes : [];
      element("admin-communes").innerHTML = communes.length ? communes.map((item) => `<div class="admin-commune"><div><strong>${escapeHtml(item.name)} <small>(${escapeHtml(item.code)})</small></strong><span>${escapeHtml(item.departmentName)} · ${escapeHtml(item.departmentCode)}</span></div><span class="readiness-pill${item.active ? " is-ready" : ""}">${item.active ? "Active" : "Inactive"}</span></div>`).join("") : `<p class="account-empty">Aucune commune n’est encore configurée.</p>`;
      const rateCards = Array.isArray(rateData.rateCards) ? rateData.rateCards : [];
      activeRateVersion = rateData.activeVersion ?? overview.activeRateVersion ?? null;
      const savedDraft = rateCards.find((card) => card.status === "draft") ?? null;
      const active = rateCards.find((card) => (card.id ?? card.version) === activeRateVersion) ?? null;
      selectedRateDraftVersion = savedDraft ? (savedDraft.id ?? savedDraft.version) : null;
      rateDraftDirty = false;
      const source = savedDraft ?? active;
      const editorCard = source ? {
        version: savedDraft ? (savedDraft.id ?? savedDraft.version) : "",
        status: "draft", currency: source.currency, tierBasis: source.tierBasis,
        volumetricDivisor: source.volumetricDivisor, minimumBillableKg: source.minimumBillableKg,
        maxAutoQuoteKg: source.maxAutoQuoteKg, zones: source.zones,
      } : emptyRateDraft;
      renderRateEditor(editorCard);
      element("rate-effective-from").value = typeof savedDraft?.effectiveFrom === "string" ? savedDraft.effectiveFrom : "";
      element("rate-effective-until").value = typeof savedDraft?.effectiveUntil === "string" ? savedDraft.effectiveUntil : "";
      const dateIssue = savedDraft ? rateDateIssue(savedDraft) : null;
      element("activate-rate").disabled = !savedDraft || Boolean(dateIssue);
      if (savedDraft) {
        setRateDraftStatus(dateIssue
          ? `Brouillon ${selectedRateDraftVersion} enregistré. ${dateIssue}`
          : `Brouillon ${selectedRateDraftVersion} enregistré et prêt à être activé. La période sélectionnée est inclusive au fuseau d’Haïti.`);
      } else if (active) {
        setRateDraftStatus(`Le barème actif ${activeRateVersion} est chargé comme modèle. Choisissez une nouvelle version et ses dates, puis enregistrez-la comme brouillon.`);
      } else {
        setRateDraftStatus("Aucun barème enregistré. Saisissez un tarif validé, une nouvelle version et sa période avant d’enregistrer le brouillon.");
      }
      renderAdminLegalDocument();
      renderAdminPolicyDocument();
      setStatus(notice, "Configuration chargée.", "is-success");
    } catch (error) {
      setStatus(notice, requestErrorMessage(error, "Le panneau d’administration est temporairement indisponible."), "is-error");
    }
  }
  async function mutate(action, fallback, success) {
    if (!currentUser || busy) return;
    busy = true;
    setStatus(notice, "Enregistrement…");
    try {
      await action();
      setStatus(notice, success, "is-success");
      await load();
    } catch (error) {
      setStatus(notice, requestErrorMessage(error, fallback), "is-error");
    } finally { busy = false; }
  }
  function renderAdminLegalDocument() {
    const legalDocument = legalDocuments[selectedLegalDocument] ?? {};
    const content = legalDocument.draft ?? legalDocument.published;
    element("legal-title").value = content?.title ?? "";
    element("legal-body").value = content?.body ?? "";
    element("legal-preview-title").textContent = element("legal-title").value;
    const published = legalDocument.published;
    element("legal-published-status").textContent = published
      ? `Version ${published.version} publiée le ${formatDate(published.publishedAt, true)}.`
      : "Aucune version n’est publiée. La page publique conserve son document de travail.";
    element("legal-publish-confirm").checked = false;
    element("legal-publish").disabled = true;
    legalDraftDirty = false;
    renderLegalBody(element("legal-preview-body"), element("legal-body").value);
  }
  function renderAdminPolicyDocument() {
    const policy = adminPolicies[selectedAdminPolicy] ?? {};
    const content = policy.draft ?? policy.published;
    element("admin-policy-title").value = content?.title ?? "";
    element("admin-policy-body").value = content?.body ?? "";
    element("admin-policy-preview-title").textContent = element("admin-policy-title").value;
    const published = policy.published;
    element("admin-policy-published-status").textContent = published
      ? `Version ${published.version} validée le ${formatDate(published.publishedAt, true)}.`
      : "Aucune version validée. Rédigez puis enregistrez un brouillon.";
    element("admin-policy-confirm").checked = false;
    element("admin-policy-publish").disabled = true;
    adminPolicyDraftDirty = false;
    renderLegalBody(element("admin-policy-preview-body"), element("admin-policy-body").value);
  }
  element("commune-name").addEventListener("input", updateCommuneCode);
  element("department-name").addEventListener("input", updateCommuneCode);
  function updateCommuneCode() {
    element("commune-generated-code").value = getCommuneCode(element("department-name").value, element("commune-name").value);
    element("department-generated-code").value = getDepartmentCode(element("department-name").value);
  }
  element("commune-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const name = element("commune-name").value.trim();
    const departmentName = element("department-name").value.trim();
    const code = getCommuneCode(departmentName, name);
    const departmentCode = getDepartmentCode(departmentName);
    if (!code || !departmentCode) return setStatus(notice, "Nom de commune ou département invalide.", "is-error");
    void mutate(() => request(`/v1/admin/communes/${encodeURIComponent(code)}`, {
      method: "PUT", user: currentUser,
      body: JSON.stringify({ name, departmentCode, departmentName, active: element("commune-active").checked }),
    }), "Impossible d’enregistrer la commune. Vérifiez les champs et l’accès Firebase.", "Commune enregistrée.");
  });
  element("save-origin").addEventListener("click", () => void mutate(() => request("/v1/admin/dispatch-origin", {
    method: "PUT", user: currentUser, body: JSON.stringify({ communeCode: element("origin-code").value.trim().toUpperCase() }),
  }), "L’origine doit correspondre à une commune active.", "Point d’origine enregistré."));
  element("rate-form").addEventListener("input", (event) => {
    if (event.target.matches("#rate-version, #rate-max-auto-quote, #rate-effective-from, #rate-effective-until") || event.target.closest("[data-rate-tier]")) markRateDraftDirty();
  });
  element("rate-form").addEventListener("change", (event) => {
    if (event.target.matches("[data-rate-method]")) {
      const row = event.target.closest("[data-rate-tier]");
      const perKg = event.target.value === "per_kg";
      row.querySelector("[data-rate-first-prices]").hidden = perKg;
      row.querySelector("[data-rate-per-kg-price]").hidden = !perKg;
      row.querySelectorAll("[data-rate-first-kg], [data-rate-additional-kg]").forEach((input) => { input.required = !perKg; });
      row.querySelector("[data-rate-price-per-kg]").required = perKg;
    }
    if (event.target.closest("[data-rate-tier]") || event.target.matches("#rate-version, #rate-max-auto-quote, #rate-effective-from, #rate-effective-until")) markRateDraftDirty();
  });
  element("rate-form").addEventListener("click", (event) => {
    const addButton = event.target.closest("[data-add-rate-tier]");
    if (addButton) {
      addRateTier(addButton.dataset.addRateTier);
      return;
    }
    const removeButton = event.target.closest("[data-remove-rate-tier]");
    if (!removeButton) return;
    const row = removeButton.closest("[data-rate-tier]");
    const zone = row.dataset.zone;
    const list = element(`rate-tiers-${zone}`);
    row.remove();
    const rows = [...list.querySelectorAll("[data-rate-tier]")];
    rows.forEach((tierRow, index) => {
      tierRow.querySelector("[data-rate-tier-number]").textContent = String(index + 1);
      tierRow.querySelector("[data-remove-rate-tier]").setAttribute("aria-label", `Supprimer la tranche ${index + 1} de la zone ${rateZoneNames[zone]}`);
    });
    element("admin-rates").querySelector(`[data-add-rate-tier="${zone}"]`).disabled = false;
    if (!rows.length) list.innerHTML = `<p class="rate-zone-empty">Ajoutez au moins une tranche pour compléter cette zone.</p>`;
    markRateDraftDirty();
  });
  element("rate-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const card = readRateDraft();
    if (!card) return;
    void mutate(() => request(`/v1/admin/rate-cards/${encodeURIComponent(card.version)}`, {
      method: "PUT", user: currentUser, body: JSON.stringify(card),
    }), "Barème invalide, incomplet ou impossible à enregistrer.", "Barème enregistré en brouillon. Il ne sera pas utilisé avant son activation.");
  });
  element("activate-rate").addEventListener("click", () => {
    if (!selectedRateDraftVersion || rateDraftDirty) return setRateDraftStatus("Enregistrez un brouillon avant de l’activer.", "is-error");
    const card = readRateDraft();
    if (!card) return;
    if (card.version !== selectedRateDraftVersion) return setRateDraftStatus("La version affichée ne correspond pas au brouillon enregistré. Enregistrez d’abord le brouillon.", "is-error");
    const dateIssue = rateDateIssue(card);
    if (dateIssue) return setRateDraftStatus(dateIssue, "is-error");
    const coverageIssue = rateCoverageIssue(card);
    if (coverageIssue) return setRateDraftStatus(coverageIssue, "is-error");
    if (!window.confirm(`Activer le barème ${card.version} du ${card.effectiveFrom}${card.effectiveUntil ? ` au ${card.effectiveUntil} inclus` : " sans date de fin"} ?`)) return;
    void mutate(() => request(`/v1/admin/rate-cards/${encodeURIComponent(card.version)}/activate`, {
      method: "POST", user: currentUser,
    }), "Activation refusée : créez d’abord un brouillon complet, sans trou dans les tranches de chaque zone.", "Nouveau barème activé.");
  });
  element("legal-document-select").addEventListener("change", (event) => {
    const nextDocument = event.target.value;
    if (legalDraftDirty && !window.confirm("Le brouillon modifié n’est pas enregistré. Changer de document quand même ?")) {
      event.target.value = selectedLegalDocument;
      return;
    }
    selectedLegalDocument = nextDocument;
    renderAdminLegalDocument();
  });
  for (const id of ["legal-title", "legal-body"]) {
    element(id).addEventListener("input", () => {
      legalDraftDirty = true;
      element("legal-publish-confirm").checked = false;
      element("legal-publish").disabled = true;
      element("legal-preview-title").textContent = element("legal-title").value;
      renderLegalBody(element("legal-preview-body"), element("legal-body").value);
    });
  }
  element("legal-save-draft").addEventListener("click", () => {
    const draft = { title: element("legal-title").value.trim(), body: element("legal-body").value.trim() };
    if (draft.title.length < 4 || draft.body.length < 80) {
      return setStatus(notice, "Ajoutez un titre et au moins 80 caractères de contenu.", "is-error");
    }
    void mutate(async () => {
      await request(`/v1/admin/legal-content/${selectedLegalDocument}`, {
        method: "PUT", user: currentUser, body: JSON.stringify(draft),
      });
      legalDraftDirty = false;
    }, "Impossible d’enregistrer le brouillon. Vérifiez votre rôle administrateur.", "Brouillon juridique enregistré.");
  });
  element("legal-publish-confirm").addEventListener("change", (event) => {
    element("legal-publish").disabled = !event.target.checked || legalDraftDirty;
  });
  element("legal-publish").addEventListener("click", () => {
    if (legalDraftDirty) return setStatus(notice, "Enregistrez d’abord le brouillon avant de le publier.", "is-error");
    if (!element("legal-publish-confirm").checked) return setStatus(notice, "Confirmez la relecture avant publication.", "is-error");
    if (!window.confirm("Publier cette nouvelle version sur la page publique ?")) return;
    void mutate(() => request(`/v1/admin/legal-content/${selectedLegalDocument}/publish`, {
      method: "POST", user: currentUser, body: JSON.stringify({ confirm: true }),
    }), "Impossible de publier cette version. Vérifiez le brouillon et votre rôle.", "Nouvelle version juridique publiée.");
  });
  element("admin-policy-select").addEventListener("change", (event) => {
    const nextPolicy = event.target.value;
    if (adminPolicyDraftDirty && !window.confirm("Le brouillon modifié n’est pas enregistré. Changer de document quand même ?")) {
      event.target.value = selectedAdminPolicy;
      return;
    }
    selectedAdminPolicy = nextPolicy;
    renderAdminPolicyDocument();
  });
  for (const id of ["admin-policy-title", "admin-policy-body"]) {
    element(id).addEventListener("input", () => {
      adminPolicyDraftDirty = true;
      element("admin-policy-confirm").checked = false;
      element("admin-policy-publish").disabled = true;
      element("admin-policy-preview-title").textContent = element("admin-policy-title").value;
      renderLegalBody(element("admin-policy-preview-body"), element("admin-policy-body").value);
    });
  }
  element("admin-policy-save-draft").addEventListener("click", () => {
    const draft = { title: element("admin-policy-title").value.trim(), body: element("admin-policy-body").value.trim() };
    if (draft.title.length < 4 || draft.body.length < 80) {
      return setStatus(notice, "Ajoutez un titre et au moins 80 caractères de contenu.", "is-error");
    }
    void mutate(async () => {
      await request(`/v1/admin/policies/${selectedAdminPolicy}`, {
        method: "PUT", user: currentUser, body: JSON.stringify(draft),
      });
      adminPolicyDraftDirty = false;
    }, "Impossible d’enregistrer le brouillon. Vérifiez votre rôle administrateur.", "Brouillon interne enregistré.");
  });
  element("admin-policy-confirm").addEventListener("change", (event) => {
    element("admin-policy-publish").disabled = !event.target.checked || adminPolicyDraftDirty;
  });
  element("admin-policy-publish").addEventListener("click", () => {
    if (adminPolicyDraftDirty) return setStatus(notice, "Enregistrez d’abord le brouillon avant validation.", "is-error");
    if (!element("admin-policy-confirm").checked) return setStatus(notice, "Confirmez la relecture avant validation.", "is-error");
    if (!window.confirm("Valider cette version interne ? Cela ne déclenche aucune suppression automatique de données.")) return;
    void mutate(() => request(`/v1/admin/policies/${selectedAdminPolicy}/publish`, {
      method: "POST", user: currentUser, body: JSON.stringify({ confirm: true }),
    }), "Impossible de valider cette version. Vérifiez le brouillon et votre rôle.", "Nouvelle version interne validée.");
  });
  element("role-user-role").addEventListener("change", () => {
    element("support-role-help").hidden = element("role-user-role").value !== "support";
    element("role-confirm").checked = false;
  });
  element("role-user-uid").addEventListener("input", () => { element("role-confirm").checked = false; });
  element("role-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const uid = element("role-user-uid").value.trim();
    const role = element("role-user-role").value;
    if (!/^[A-Za-z0-9:_-]{1,128}$/.test(uid)) return setStatus(notice, "UID Firebase invalide.", "is-error");
    if (!element("role-confirm").checked) return setStatus(notice, "Confirmez l’UID et le rôle avant l’enregistrement.", "is-error");
    if (role === "support") return setStatus(notice, "Le rôle support reste désactivé tant que ses permissions ne sont pas définies.", "is-error");
    void mutate(() => request(`/v1/admin/users/${encodeURIComponent(uid)}/role`, {
      method: "PUT", user: currentUser, body: JSON.stringify({ role }),
    }), "Impossible de modifier ce rôle. Vérifiez l’UID Firebase et les autorisations.", `Rôle ${role} attribué. L’utilisateur devra renouveler sa session.`);
  });
  observeSignedInUser((user, error) => {
    if (error) return setStatus(notice, "Firebase n’est pas configuré pour cet environnement.", "is-error");
    if (!user) return redirectToSignIn();
    currentUser = user;
    void load();
  });
}

const page = document.documentElement.dataset.page;
if (page === "home" || page === "tracking") initHome();
if (page === "signin") initSignIn();
if (page === "finish-signin") initFinishSignIn();
if (page === "claim") initClaim();
if (page === "account") initAccount();
if (page === "operations") initOperations();
if (page === "admin") initAdmin();
if (page === "legal") void initLegal();
