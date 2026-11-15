// Light / dark / system toggle. Stored per viewer; every read and write is guarded.
(function () {
  const KEY = "fc-theme", root = document.documentElement, subs = [];
  try { const v = localStorage.getItem(KEY); if (v === "light" || v === "dark") root.setAttribute("data-theme", v); } catch (e) { /* storage blocked */ }
  FC.isDark = () => {
    const t = root.getAttribute("data-theme");
    return t ? t === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
  };
  FC.onTheme = fn => subs.push(fn);
  const fire = () => subs.forEach(f => f());
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", fire);
  FC.toggleTheme = function () {
    const next = FC.isDark() ? "light" : "dark";
    root.setAttribute("data-theme", next);
    try { localStorage.setItem(KEY, next); } catch (e) { /* ignore */ }
    fire();
  };
  FC.css = name => getComputedStyle(root).getPropertyValue(name).trim();
})();
