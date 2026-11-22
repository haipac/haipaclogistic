const header = document.querySelector(".site-header");
const menuButton = header?.querySelector(".menu-toggle");
const menu = header?.querySelector("#primary-navigation");
const menuLabel = menuButton?.querySelector(".sr-only");
const currentYear = document.querySelector("[data-current-year]");
if (currentYear) currentYear.textContent = String(new Date().getFullYear());

function setMenuOpen(open, { returnFocus = false } = {}) {
  if (!header || !menuButton || !menu) return;
  header.dataset.menuOpen = String(open);
  menuButton.setAttribute("aria-expanded", String(open));
  if (menuLabel) menuLabel.textContent = open ? "Fermer le menu" : "Ouvrir le menu";
  if (open) menu.querySelector("a")?.focus({ preventScroll: true });
  else if (returnFocus) menuButton.focus({ preventScroll: true });
}

menuButton?.addEventListener("click", () => {
  setMenuOpen(menuButton.getAttribute("aria-expanded") !== "true");
});

menu?.addEventListener("click", (event) => {
  if (event.target.closest("a")) setMenuOpen(false);
});

const heroTabs = [...document.querySelectorAll('.hero-tabs [role="tab"]')];
if (heroTabs.length) {
  const selectHeroTab = (tab, { focus = false } = {}) => {
    heroTabs.forEach((candidate) => {
      const selected = candidate === tab;
      candidate.setAttribute("aria-selected", String(selected));
      candidate.tabIndex = selected ? 0 : -1;
      candidate.classList.toggle("transport-icon-active", selected);
      const panel = document.getElementById(candidate.getAttribute("aria-controls"));
      if (panel) panel.hidden = !selected;
    });
    if (focus) tab.focus();
  };

  heroTabs.forEach((tab, index) => {
    tab.addEventListener("click", () => selectHeroTab(tab));
    tab.addEventListener("keydown", (event) => {
      let nextIndex = index;
      if (event.key === "ArrowRight" || event.key === "ArrowDown") nextIndex = (index + 1) % heroTabs.length;
      else if (event.key === "ArrowLeft" || event.key === "ArrowUp") nextIndex = (index - 1 + heroTabs.length) % heroTabs.length;
      else if (event.key === "Home") nextIndex = 0;
      else if (event.key === "End") nextIndex = heroTabs.length - 1;
      else return;
      event.preventDefault();
      selectHeroTab(heroTabs[nextIndex], { focus: true });
    });
  });
}

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && header?.dataset.menuOpen === "true") {
    setMenuOpen(false, { returnFocus: true });
  }
});

document.addEventListener("click", (event) => {
  if (header?.dataset.menuOpen === "true" && !header.contains(event.target)) setMenuOpen(false);
});

const journalFilters = document.querySelector("[data-journal-filters]");
if (journalFilters) {
  const filterButtons = [...journalFilters.querySelectorAll("[data-journal-filter]")];
  const journalCards = [...document.querySelectorAll("[data-journal-category]")];
  const journalStatus = document.querySelector("[data-journal-status]");
  const journalEmpty = document.querySelector("[data-journal-empty]");
  const applyJournalFilter = (filter) => {
    const visibleCards = journalCards.filter((card) => filter === "all" || card.dataset.journalCategory === filter);
    journalCards.forEach((card) => {
      const visible = visibleCards.includes(card);
      card.hidden = !visible;
      card.classList.remove("journal-filter-enter");
      if (visible) {
        void card.offsetWidth;
        card.classList.add("journal-filter-enter");
      }
    });
    filterButtons.forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.journalFilter === filter)));
    if (journalEmpty) journalEmpty.hidden = visibleCards.length !== 0;
    if (journalStatus) journalStatus.textContent = `${visibleCards.length} ${visibleCards.length === 1 ? "guide affiché" : "guides affichés"}.`;
  };

  filterButtons.forEach((button) => button.addEventListener("click", () => applyJournalFilter(button.dataset.journalFilter)));
  document.querySelector("[data-journal-reset]")?.addEventListener("click", () => {
    const allButton = filterButtons.find((button) => button.dataset.journalFilter === "all");
    if (allButton) {
      applyJournalFilter("all");
      allButton.focus();
    }
  });
}

const contactMailForm = document.querySelector("[data-contact-mail-form]");
if (contactMailForm) {
  const status = contactMailForm.querySelector("[data-contact-form-status]");
  const mailLink = contactMailForm.querySelector("[data-contact-mail-link]");
  contactMailForm.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!contactMailForm.reportValidity() || !mailLink) return;

    const formData = new FormData(contactMailForm);
    const name = String(formData.get("name") || "").trim();
    const email = String(formData.get("email") || "").trim();
    const subject = String(formData.get("subject") || "Question générale").trim();
    const message = String(formData.get("message") || "").trim();
    const body = `Nom : ${name}\nE-mail de réponse : ${email}\n\n${message}`;
    mailLink.href = `mailto:haipaclogistics@gmail.com?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    mailLink.hidden = false;
    if (status) status.textContent = "Votre message est prêt. Choisissez le lien ci-dessous pour l’ouvrir dans votre application e-mail; il n’a pas encore été envoyé.";
    mailLink.focus();
  });
}

const revealTargets = document.querySelectorAll(
  ".hero-transport, .hero-visual, .trust-item, .section-heading, .service-card, .service-row-media, .service-capability-card, .journey-intro, .journey-list li, .faq-visual, .faq-content, .faq-list details, .tracking-copy, .tracking-panel, .cta-card, .auth-card, .account-title, .account-section, .admin-readiness, .operations-toolbar, .operations-list, .legal-content, .capability-explorer, .capability-panel, .guide-card, .blog-card, .journal-filters > *, .journal-card, .public-hero-copy, .public-hero-media, .public-intro-grid > *, .public-feature-copy, .public-feature-media, .public-step-grid > li, .public-faq-grid > *, .public-cta-inner > *, .about-hero > *, .about-network-visual, .team-hero > *, .team-role-card, .team-responsibility-grid > *, .values-grid article, .about-commitment-copy > *, .commitment-list li, .readiness-grid article, .pricing-hero > *, .pricing-factor-grid article, .pricing-notice, .weight-rule-copy > *, .weight-rule-media, .weight-equation > *, .pricing-publication-list article, .contact-hero > *, .contact-grid > *, .contact-form-layout > *, .contact-topic-grid > *, .contact-note p, .guides-hero > *, .guide-article > *, .article-heading > *, .article-cover, .article-layout > *, .article-body > *, .article-related > *, .service-template-eyebrow, .service-template-content h1, .service-template-links > *, .service-template-bottom > *, .site-footer .footer-columns > *"
);

const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
if (revealTargets.length && !reduceMotion && "IntersectionObserver" in window) {
  document.documentElement.classList.add("motion-ready");
  const siblingOrder = new Map();
  revealTargets.forEach((element) => {
    element.dataset.reveal = element.matches(".faq-visual, .service-row-media, .public-hero-media, .public-feature-media, .about-hero-media, .about-network-visual, .team-orbit, .about-commitment-media, .weight-rule-media, .contact-visual") ? "image" : "text";
    const parent = element.parentElement;
    const order = siblingOrder.get(parent) || 0;
    siblingOrder.set(parent, order + 1);
    element.style.transitionDelay = `${80 + Math.min(order, 4) * 75}ms`;
  });

  const observer = new IntersectionObserver((entries, currentObserver) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add("is-visible");
        currentObserver.unobserve(entry.target);
      }
    });
  }, { threshold: 0.12, rootMargin: "0px 0px -5% 0px" });
  revealTargets.forEach((element) => observer.observe(element));
}
