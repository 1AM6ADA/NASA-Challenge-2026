// Explorer: one state object (place, month, metric), everything else is a view of it.
(async function () {
  const $ = id => document.getElementById(id);
  $("theme").addEventListener("click", FC.toggleTheme);
  $("fs").addEventListener("click", () => {
    const d = document;
    (d.fullscreenElement ? d.exitFullscreen() : d.documentElement.requestFullscreen()).catch(() => { /* not allowed here */ });
  });
  await FC.load({ keepLoader: true });

  const last = FC.Mo - 1;
  let ready = false; // the map reports its first selection before the panels below exist
  const app = { m: last, sel: null, vals: new Float64Array(FC.Mo), calMode: "count", pins: {}, tab: "overview" };
  const srcName = m => ({ viirs: "VIIRS", noaa20: "NOAA-20, rescaled", modis: "MODIS, rescaled", modis_terra: "Terra only, rescaled" }[FC.meta.source[m]]);
  const areaName = s => (!s || s.kind === "all" ? "All loaded data" : s.kind === "country" ? s.name : "Custom area");
  const pct = a => `${a >= 0 ? "+" : "−"}${Math.abs(Math.round(a * 100))}%`;

  const timeline = FC.createTimeline($("timeline"), { onPick: m => setMonth(m) });

  // ---- map ----
  const place = $("place");
  FC.countries.forEach(c => place.add(new Option(c.name, c.name)));
  const map = await FC.createMap({
    canvas: $("map-canvas"), svg: $("map-svg"), legend: $("legend"),
    onSelect(sel) {
      app.sel = sel; app.vals = FC.areaSeries(sel.tiles);
      place.value = sel.kind === "all" ? "all" : sel.kind === "country" ? sel.name : "custom";
      $("clear-sel").hidden = sel.kind === "all";
      if (ready) refresh();
    },
  });
  FC.map = map; // exposed for profiling
  FC.ui.done();
  map.setMonth(app.m);
  place.addEventListener("change", () => { if (place.value === "all") { map.selectAll(); map.home(); } else map.selectCountry(place.value); });

  const hints = {
    pan: "Drag to move, scroll to zoom. Hover a hexagon to read it.",
    rect: "Drag on the map to draw a box.",
    poly: "Click to add corners. Double-click to finish. Esc cancels.",
    country: "Click a country, or pick one from the Place list.",
  };
  const setTool = t => {
    map.setTool(t); $("hint").textContent = hints[t];
    document.querySelectorAll("[data-tool]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.tool === t)));
  };
  document.querySelectorAll("[data-tool]").forEach(b => b.addEventListener("click", () => setTool(b.dataset.tool)));
  document.querySelectorAll("[data-zoom]").forEach(b => b.addEventListener("click", () => map.zoomBy(+b.dataset.zoom)));
  const resetAll = () => { map.selectAll(); map.home(); };
  $("home").addEventListener("click", resetAll);
  $("clear-sel").addEventListener("click", resetAll);
  setTool("pan");

  const seg = (sel, attr, fn) => document.querySelectorAll(sel).forEach(b => b.addEventListener("click", () => {
    document.querySelectorAll(sel).forEach(x => x.setAttribute("aria-pressed", String(x === b))); fn(b.dataset[attr]);
  }));
  seg("[data-metric]", "metric", v => map.setMetric(v));
  seg("[data-cal]", "cal", v => { app.calMode = v; drawCalendar(); });

  // ---- time ----
  let timer = null;
  const setPlaying = on => {
    if (!on) { clearInterval(timer); timer = null; } else timer = setInterval(() => setMonth(app.m >= last ? 0 : app.m + 1), 140);
    $("play").innerHTML = on ? '<svg viewBox="0 0 24 24"><path d="M8 5v14M16 5v14"/></svg>' : '<svg viewBox="0 0 24 24"><path d="M8 5l11 7-11 7z"/></svg>';
  };
  $("play").addEventListener("click", () => setPlaying(!timer));
  $("prev").addEventListener("click", () => setMonth(app.m - 1));
  $("next").addEventListener("click", () => setMonth(app.m + 1));
  window.addEventListener("keydown", e => {
    if (/INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName) || e.metaKey || e.ctrlKey) return;
    if (e.key === "ArrowLeft") setMonth(app.m - (e.shiftKey ? 12 : 1));
    else if (e.key === "ArrowRight") setMonth(app.m + (e.shiftKey ? 12 : 1));
    else if (e.key === " ") { e.preventDefault(); setPlaying(!timer); }
  });
  function setMonth(m) {
    m = Math.max(0, Math.min(last, m));
    if (m === app.m) return;
    app.m = m;
    map.setMonth(m);
    $("month-label").textContent = FC.monthLabel(m);
    $("month-src").textContent = srcName(m);
    timeline.set(app.vals, m);
    drawKpi();
    if (cal) cal.setSelected(m);
    if (seas) seas.setSelected(m);
    drawAlerts(); writeHash();
    if (app.tab === "compare") renderCompare();
    if (app.tab === "data") updateDownloads();
  }

  // ---- overview ----
  function drawKpi() {
    const { vals, m } = app, v = vals[m], km2 = app.sel.km2, an = FC.anomaly(vals, m), med = FC.looMedian(vals, m), rk = FC.rankOfMonth(vals, m);
    const mon = FC.longMonths[FC.cal[m]];
    $("area-name").textContent = areaName(app.sel) + (app.sel.kind === "country" ? ", part inside loaded data" : "");
    const pill = $("kpi-pill");
    if (an === null) { pill.textContent = "No baseline"; pill.style.color = "var(--muted)"; $("kpi-head").textContent = v > 0 ? "Fire where there is usually none" : "No fire detected"; }
    else {
      const tone = Math.abs(an) < 0.1 ? "Near normal" : an > 0 ? "Above normal" : "Below normal";
      pill.textContent = tone; pill.style.color = "var(--ink)"; pill.style.borderColor = Math.abs(an) < 0.1 ? "var(--line-2)" : FC.diverge(Math.sign(an) * Math.min(1, 0.4 + Math.abs(an)));
      pill.style.background = `color-mix(in srgb, ${Math.abs(an) < 0.1 ? "var(--surface-2)" : FC.diverge(Math.sign(an) * 0.55)} 18%, transparent)`;
      const so = rk ? "" : " so far";
      $("kpi-head").textContent = Math.abs(an) < 0.05 ? `A normal ${mon}${so}` : `${Math.abs(Math.round(an * 100))}% ${an > 0 ? "above" : "below"} a normal ${mon}${so}`;
    }
    $("kpi-body").textContent = rk
      ? `${FC.monthLabel(m)} had ${FC.fmt(v)} fire cell-days. A normal ${mon}, the median of the other years, has ${FC.fmt(med)}. It ranks ${rk.rank} of ${rk.of} for the month.`
      : `${FC.monthLabel(m)} has ${FC.fmt(v)} fire cell-days so far. By the same day a normal ${mon} has about ${FC.fmt(med)} (the median of the other years, pro-rated). The month is not finished, so it has no rank yet.`;
    if (app.extras?.vals !== vals) { // busiest month / year only change with the selection, not the month
      const bestM = d3.greatest(d3.range(FC.Mo).filter(k => k !== FC.partialIdx), k => vals[k]);
      const yearTot = d3.rollups(d3.range(FC.Mo), a => d3.sum(a, k => vals[k]), k => FC.year[k])
        .filter(d => FC.months.filter(x => x.startsWith(d[0])).length === 12);
      app.extras = { vals, bestM, bestY: yearTot.length ? d3.greatest(yearTot, d => d[1]) : null };
    }
    const { bestM, bestY } = app.extras;
    $("stats").innerHTML = [
      [FC.fmt1(km2 ? v / km2 * 1000 : 0), "per 1000 km² this month"],
      [FC.monthLabel(bestM), `busiest month, ${FC.fmt(vals[bestM])}`],
      [bestY ? bestY[0] : "–", bestY ? `busiest full year, ${FC.fmt(bestY[1])}` : "no full year"],
    ].map(([b, s]) => `<div><b>${b}</b><span>${s}</span></div>`).join("");
  }
  let cal = null, seas = null;
  function drawCalendar() {
    cal = FC.drawCalendar($("calendar"), app.vals, { mode: app.calMode, selected: app.m, onPick: setMonth, legend: $("cal-legend") });
    if ($("tab-data").hidden === false) FC.calendarTable(d3.select($("cal-table")), app.vals);
  }
  function drawSeason() { seas = FC.drawSeason($("season"), app.vals, app.m); }

  // ---- compare ----
  const colA = "var(--s1)", colB = "var(--s2)";
  const pinLabel = p => `${areaName(p.sel)}, ${FC.monthLabel(p.m)}`;
  const slotStats = p => { const vals = FC.areaSeries(p.sel.tiles), km2 = p.sel.km2; return { vals, dens: vals[p.m] / km2 * 1000, an: FC.anomaly(vals, p.m), v: vals[p.m], km2 }; };
  function renderCompare() {
    const host = $("slots"); host.replaceChildren();
    const stats = {};
    for (const [id, col] of [["A", colA], ["B", colB]]) {
      const p = app.pins[id], d = document.createElement("div");
      if (!p) { d.className = "slot empty"; d.textContent = `Pin A or B from the current view to fill slot ${id}.`; host.append(d); continue; }
      const s = stats[id] = slotStats(p);
      d.className = "slot";
      d.innerHTML = `<h4><i style="background:${col}"></i>${id} · ${pinLabel(p)}</h4><div class="big">${FC.fmt1(s.dens)}</div><div class="u">fire cell-days per 1000 km²</div>
        <dl><dt>Cell-days</dt><dd>${FC.fmt(s.v)}</dd><dt>Area</dt><dd>${FC.fmt(s.km2)} km²</dd><dt>Vs normal</dt><dd>${s.an === null ? "n/a" : pct(s.an)}</dd><dt>Source</dt><dd>${srcName(p.m)}</dd></dl>`;
      host.append(d);
    }
    const chart = $("cmp-chart"); chart.replaceChildren();
    const A = app.pins.A, B = app.pins.B;
    if (!(A && B)) { $("verdict").textContent = ""; return; }
    $("verdict").textContent = stats.B.dens > 0
      ? `Per unit area, A shows ${FC.fmt1(stats.A.dens / stats.B.dens)}× the fire of B.` : "B has no fire in its month.";
    const dens = (p, s) => FC.roll12(Array.from(s.vals, v => v / s.km2 * 1000));
    FC.lineChart(chart, { width: 420, height: 250, label: "Fire density over time, A against B" }).draw([
      { id: "a", label: "A: " + areaName(A.sel), endLabel: "A", color: colA, values: dens(A, stats.A), from: 11, width: 2.2 },
      { id: "b", label: "B: " + areaName(B.sel), endLabel: "B", color: colB, values: dens(B, stats.B), from: 11, width: 2.2 },
    ], { instant: true, yFormat: FC.fmt1, yLabel: "per 1000 km², trailing 12 months", tipTitle: i => `12 months to ${FC.monthLabel(i)}` });
  }
  const pin = id => { app.pins[id] = { sel: app.sel, m: app.m }; renderCompare(); };
  $("pin-a").addEventListener("click", () => pin("A"));
  $("pin-b").addEventListener("click", () => pin("B"));
  $("swap").addEventListener("click", () => { [app.pins.A, app.pins.B] = [app.pins.B, app.pins.A]; renderCompare(); });
  app.pins.A = { sel: { kind: "all", tiles: FC.allTiles, km2: FC.loadedKm2 }, m: last };
  app.pins.B = { sel: { kind: "all", tiles: FC.allTiles, km2: FC.loadedKm2 }, m: Math.max(0, last - 60) };

  // ---- where is it unusual in the chosen month: countries ranked by anomaly ----
  const alertsEl = $("alerts");
  let countrySeries = null;
  function drawAlerts() {
    countrySeries = countrySeries || FC.countries.map(c => FC.areaSeries(c.tiles));  // once: 116 countries x all months
    const m = app.m, rows = FC.countries.map((c, i) => {
      const v = countrySeries[i], an = FC.anomaly(v, m);
      return { name: c.name, an, n: v[m], med: FC.looMedian(v, m) };
    }).filter(r => r.an !== null && r.n >= 300 && r.med >= 150);  // small counts swing wildly; keep places with real fire
    rows.sort((a, b) => b.an - a.an);
    const top = rows.slice(0, 5);
    $("alerts-sec").hidden = !top.length;
    $("alerts-title").textContent = `Most above normal, ${FC.monthLabel(m)}`;
    $("alerts-sub").textContent = "Countries with at least 300 fire cell-days that month, against their own normal for it. Click one to open it.";
    alertsEl.innerHTML = top.map(r => `<li><button data-place="${r.name}"><span>${r.name}</span><b>${pct(r.an)}</b><small>${FC.fmt(r.n)} cell-days</small></button></li>`).join("");
  }
  alertsEl.addEventListener("click", e => { const b = e.target.closest("[data-place]"); if (b) map.selectCountry(b.dataset.place); });

  // ---- share link: place and month live in the address ----
  function writeHash() {
    const q = new URLSearchParams({ m: FC.months[app.m].slice(0, 7) });
    if (app.sel.kind === "country") q.set("place", app.sel.name);
    history.replaceState(null, "", "#" + q);
  }
  $("share").addEventListener("click", async () => {
    writeHash();
    try { await navigator.clipboard.writeText(location.href); $("share").textContent = "Copied"; } catch (e) { $("share").textContent = "Link is in the address bar"; }
    setTimeout(() => { $("share").textContent = "Copy link"; }, 1800);
  });
  const hashQ = new URLSearchParams(location.hash.slice(1));

  // ---- tabs ----
  document.querySelectorAll("[data-tab]").forEach(b => b.addEventListener("click", () => {
    app.tab = b.dataset.tab;
    document.querySelectorAll("[data-tab]").forEach(x => x.setAttribute("aria-selected", String(x === b)));
    for (const t of ["overview", "compare", "data"]) $("tab-" + t).hidden = t !== app.tab;
    if (app.tab === "compare") renderCompare();
    if (app.tab === "data") { updateDownloads(); FC.calendarTable(d3.select($("cal-table")), app.vals); }
    document.querySelector(".side").scrollTo({ top: 0 });
  }));

  // ---- data tab ----
  $("coverage").innerHTML = FC.regions.map(r => `<li class="${r.loaded ? "on" : ""}"><b>${r.name.replace(/_/g, " ")}</b><span>${r.loaded ? "loaded" : "not loaded yet"}</span></li>`).join("");
  function rangeDates() {
    const r = $("dl-range").value, y = FC.year[app.m], mo = FC.cal[app.m] + 1, p = n => String(n).padStart(2, "0");
    if (r === "month") return [`${y}-${p(mo)}-01`, `${y}-${p(mo)}-${p(new Date(y, mo, 0).getDate())}`];
    if (r === "year") return [`${y}-01-01`, `${y}-12-31`];
    return ["2000-11-01", "2026-12-31"];
  }
  function updateDownloads() {
    const [start, end] = rangeDates(), s = app.sel, q = new URLSearchParams({ start, end, sensor: $("dl-sensor").value });
    if (s.kind === "country") q.set("country", s.name);
    else {
      const poly = s.kind === "all" ? FC.loadedRegions.length === 1 ? bboxOf(FC.loadedRegions[0].bbox) : FC.bboxPoly() : s.poly;
      q.set("polygon", poly.map(p => p.map(v => v.toFixed(4)).join(",")).join(";"));
    }
    $("dl-points").dataset.url = `api/points.csv?${q}`; $("dl-points").dataset.name = `hotspots_${start}_${end}.csv`;
    const rows = ["month,fire_cell_days,source,vs_normal_pct"].concat(d3.range(FC.Mo).map(k => {
      const a = FC.anomaly(app.vals, k); return `${FC.months[k]},${Math.round(app.vals[k])},${FC.meta.source[k]},${a === null ? "" : Math.round(a * 100)}`;
    }));
    const link = $("dl-series");
    if (link.dataset.blob) URL.revokeObjectURL(link.dataset.blob);
    link.dataset.blob = link.href = URL.createObjectURL(new Blob([rows.join("\n")], { type: "text/csv" }));
    link.download = "monthly_series.csv";
    $("dl-hint").textContent = `${FC.monthLabel(app.m)} comes from ${srcName(app.m)}.`;
  }
  const bboxOf = b => [[b[0], b[1]], [b[2], b[1]], [b[2], b[3]], [b[0], b[3]]];
  $("dl-range").addEventListener("change", updateDownloads);
  $("dl-sensor").addEventListener("change", updateDownloads);
  $("dl-points").addEventListener("click", async ev => {
    ev.preventDefault();
    const el = ev.currentTarget, hint = $("dl-hint"); hint.textContent = "Preparing the file…";
    try {
      const r = await fetch(el.dataset.url);
      if (!r.ok) throw new Error(r.status);
      const a = document.createElement("a"); a.href = URL.createObjectURL(await r.blob()); a.download = el.dataset.name; a.click();
      hint.textContent = "Done.";
    } catch (e) { hint.textContent = "Hotspot files need the local server (python3 api/server.py). The monthly series works without it."; }
  });

  function refresh() {
    $("month-label").textContent = FC.monthLabel(app.m);
    $("month-src").textContent = srcName(app.m);
    timeline.set(app.vals, app.m);
    drawKpi(); drawCalendar(); drawSeason(); drawAlerts(); writeHash();
    if (app.tab === "data") updateDownloads();
  }
  FC.onTheme(() => { map.refreshTheme(); timeline.set(app.vals, app.m); refresh(); renderCompare(); });
  ready = true;
  refresh();
  renderCompare();
  const hp = hashQ.get("place"), hm = FC.months.findIndex(x => x.startsWith(hashQ.get("m") || "never"));
  if (hp && FC.countries.some(c => c.name === hp)) map.selectCountry(hp);
  if (hm >= 0) setMonth(hm);
})();
