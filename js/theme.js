// tema claro/escuro: o <head> de cada página já aplica o tema salvo antes de
// pintar (evita piscar); aqui só ficam os botões [data-theme-toggle] e a cor
// da barra do navegador
(function () {
  const KEY = "financas:theme";
  const BAR = { light: "#F6F4EF", dark: "#0F0E17" };
  const root = document.documentElement;

  function current() {
    if (root.dataset.theme === "dark" || root.dataset.theme === "light") return root.dataset.theme;
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }

  function apply(theme) {
    root.dataset.theme = theme;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", BAR[theme]);
    document.querySelectorAll("[data-theme-toggle]").forEach((btn) => {
      btn.setAttribute("aria-pressed", theme === "dark" ? "true" : "false");
      const label = btn.querySelector(".theme-label");
      if (label) label.textContent = theme === "dark" ? "Tema claro" : "Tema escuro";
    });
  }

  document.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-theme-toggle]");
    if (!btn) return;
    const next = current() === "dark" ? "light" : "dark";
    try { localStorage.setItem(KEY, next); } catch { /* sem storage: vale só nesta visita */ }
    apply(next);
  });

  apply(current());
})();
