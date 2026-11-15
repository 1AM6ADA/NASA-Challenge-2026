// Colour scales. Heat is one orange-red family (dark-to-bright on dark, pale-to-deep on light);
// the diverging scale is blue (below normal) to orange (above) through a neutral midpoint.
(function () {
  const HEAT = {
    light: ["#fff0dc", "#ffd18a", "#f9a03f", "#e4581a", "#a82a0b", "#4d0e05"],
    dark: ["#26170f", "#6a2b12", "#b9420f", "#f06d1a", "#ffb04a", "#fff1c8"],
  };
  const DIV = {
    light: ["#1c5aab", "#6f9fd6", "#e5e8ed", "#f2a07a", "#c4400d"],
    dark: ["#5aa0f2", "#2b4f7e", "#222830", "#7c3b1d", "#ff7a35"],
  };
  const build = set => d3.piecewise(d3.interpolateRgb, set);
  let heat, div, dark;
  const refresh = () => { dark = FC.isDark(); heat = build(HEAT[dark ? "dark" : "light"]); div = build(DIV[dark ? "dark" : "light"]); };
  refresh();
  FC.onTheme(refresh);
  // t in [0,1]; the sqrt keeps mid-range fires visible, the floor keeps the faintest fire off the background
  FC.heat = t => heat(0.1 + 0.9 * Math.sqrt(Math.max(0, Math.min(1, t))));
  FC.heatLinear = t => heat(0.1 + 0.9 * Math.max(0, Math.min(1, t)));
  FC.diverge = a => div(0.5 + Math.max(-1, Math.min(1, a)) / 2);
  FC.scaleBar = function (el, fn, lo, hi) {
    el.innerHTML = "";
    const l = document.createElement("span"); l.textContent = lo;
    const c = document.createElement("canvas"); c.width = 160; c.height = 8;
    const g = c.getContext("2d");
    for (let x = 0; x < 160; x++) { g.fillStyle = fn(x / 159); g.fillRect(x, 0, 1, 8); }
    const h = document.createElement("span"); h.textContent = hi;
    el.append(l, c, h);
  };
})();
