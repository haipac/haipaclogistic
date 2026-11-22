const pricingStatusCard = document.getElementById("pricing-status-card");
const pricingRateSection = document.getElementById("published-rate-card");
const pricingZoneList = document.getElementById("published-rate-zones");
const pricingCoverage = document.getElementById("published-communes");

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]);
}

function formatNumber(value) {
  return new Intl.NumberFormat("fr-HT", { maximumFractionDigits: 0 }).format(value);
}

function formatDate(value) {
  const [year, month, day] = String(value ?? "").split("-");
  return year && month && day ? `${day}/${month}/${year}` : "";
}

function formatRate(tier) {
  if (tier.method === "per_kg") return `${formatNumber(tier.pricePerKgHtg)} HTG / kg`;
  return `${formatNumber(tier.firstKgHtg)} HTG pour le premier kg · ${formatNumber(tier.additionalKgHtg)} HTG par kg supplémentaire`;
}

function formatWeightRange(tier) {
  const start = Number(tier.minBillableKg);
  const end = tier.maxBillableKg === null ? null : Number(tier.maxBillableKg);
  if (end === start) return `${formatNumber(start)} kg`;
  if (end === null) return `À partir de ${formatNumber(start)} kg`;
  return `${formatNumber(start)} à ${formatNumber(end)} kg`;
}

function renderZone(name, tiers, index) {
  const rows = tiers.map((tier) => `
    <tr>
      <td>${escapeHtml(formatWeightRange(tier))}</td>
      <td>${escapeHtml(formatRate(tier))}</td>
    </tr>`).join("");
  return `
    <details class="published-rate-zone"${index === 0 ? " open" : ""}>
      <summary>
        <span><strong>${escapeHtml(name)}</strong><small>${formatNumber(tiers.length)} tranche${tiers.length > 1 ? "s" : ""} · poids facturable arrondi au kilo supérieur</small></span>
        <span aria-hidden="true">＋</span>
      </summary>
      <div class="pricing-rate-table-wrap">
        <table class="pricing-rate-table">
          <caption class="sr-only">Tarifs ${escapeHtml(name)}</caption>
          <thead><tr><th scope="col">Poids facturable</th><th scope="col">Tarif en HTG</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </details>`;
}

function renderCoverage(communes) {
  const departments = new Map();
  for (const commune of communes) {
    const departmentName = String(commune.departmentName ?? "").trim();
    const name = String(commune.name ?? "").trim();
    if (!departmentName || !name) continue;
    departments.set(departmentName, [...(departments.get(departmentName) ?? []), name]);
  }
  return [...departments.entries()].map(([department, names]) => `
    <section class="coverage-department" aria-label="${escapeHtml(department)}">
      <h4>${escapeHtml(department)}</h4>
      <ul>${names.map((name) => `<li>${escapeHtml(name)}</li>`).join("")}</ul>
    </section>`).join("");
}

function renderPublishedRates(data) {
  const rateCard = data?.rateCard;
  const communes = Array.isArray(data?.communes) ? data.communes : [];
  const zoneLabels = { local: "Zone locale", regional: "Zone régionale", national: "Zone nationale" };
  const zones = Object.entries(zoneLabels)
    .filter(([key]) => Array.isArray(rateCard?.zones?.[key]))
    .map(([key, label], index) => renderZone(label, rateCard.zones[key], index));
  if (!rateCard || zones.length !== 3) return;

  const effectiveUntil = rateCard.effectiveUntil ? ` · jusqu’au ${formatDate(rateCard.effectiveUntil)}` : "";
  document.getElementById("pricing-status-pill").lastChild.textContent = " Barème actif";
  document.getElementById("pricing-status-heading").textContent = "Consultez le barème en vigueur.";
  document.getElementById("pricing-status-copy").textContent = `Version ${rateCard.version} · applicable depuis le ${formatDate(rateCard.effectiveFrom)}${effectiveUntil}.`;
  const statusLink = document.getElementById("pricing-status-link");
  statusLink.href = "#published-rate-card";
  statusLink.innerHTML = "Consulter la grille <span aria-hidden=\"true\">↘</span>";
  pricingStatusCard.classList.add("is-published");
  document.getElementById("pricing-intro-copy").textContent = "Retrouvez la grille tarifaire active, sa période d’application et les communes configurées par HAIPAC.";
  document.getElementById("published-rate-dates").textContent = `Version ${rateCard.version} · en vigueur depuis le ${formatDate(rateCard.effectiveFrom)}${effectiveUntil}.`;
  pricingZoneList.innerHTML = zones.join("");
  pricingCoverage.innerHTML = renderCoverage(communes);
  document.getElementById("published-coverage-summary").textContent = communes.length
    ? `${formatNumber(communes.length)} commune${communes.length > 1 ? "s" : ""} active${communes.length > 1 ? "s" : ""} configurée${communes.length > 1 ? "s" : ""}.`
    : "Aucune commune active n’est actuellement configurée.";
  pricingRateSection.hidden = false;
}

async function loadPublishedRates() {
  try {
    const baseUrl = document.querySelector("base")?.href || `${window.location.origin}/`;
    const response = await fetch(new URL("api/v1/rates", baseUrl), {
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    if (!response.ok) return;
    const data = await response.json();
    if (data?.published === true) renderPublishedRates(data);
  } catch {
    // Keep the static readiness message when the public rates endpoint is unavailable.
  }
}

void loadPublishedRates();
