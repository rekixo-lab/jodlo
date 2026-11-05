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
