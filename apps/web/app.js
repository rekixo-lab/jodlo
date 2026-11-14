"use strict";

// Presentation only. No localStorage, cookies, analytics, API, external script,
// geolocation, session, form or background request. Language defaults to Hindi
// every time: the choice is deliberately not a stored user preference.
const buttons = Array.from(document.querySelectorAll("[data-language-button]"));
const panels = Array.from(document.querySelectorAll("[data-language-panel]"));

function showLanguage(language) {
  if (language !== "hi" && language !== "en") return;
  for (const button of buttons) {
    button.setAttribute("aria-pressed", String(
      button.getAttribute("data-language-button") === language));
  }
  for (const panel of panels) {
    panel.hidden = panel.getAttribute("data-language-panel") !== language;
  }
  document.documentElement.lang = language;
}

for (const button of buttons) {
  button.addEventListener("click", () => {
    const language = button.getAttribute("data-language-button");
    showLanguage(language);
  });
}

const pagePanels = Array.from(document.querySelectorAll("[data-page-panel]"));
const pageLinks = Array.from(document.querySelectorAll("[data-route]"));
const routes = new Set(pagePanels.map(panel => panel.dataset.pagePanel));

function showPage() {
  const fragment = window.location.hash.slice(1);
  if (fragment === "main") return;
  const route = routes.has(fragment) ? fragment : "home";
  for (const panel of pagePanels) panel.hidden = panel.dataset.pagePanel !== route;
  for (const link of pageLinks) {
    if (link.dataset.route === route) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  }
}

window.addEventListener("hashchange", showPage);
showPage();
