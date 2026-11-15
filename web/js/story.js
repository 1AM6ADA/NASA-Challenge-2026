// Scroll story: the sticky chart changes scene as each text step crosses the middle of the screen.
(async function () {
  const $ = id => document.getElementById(id);
  $("theme").addEventListener("click", FC.toggleTheme);
  await FC.load();

  const NS = FC.Mo - (FC.partial ? 1 : 0); // charts use complete months only
  const S = Object.fromEntries(Object.entries(FC.series).map(([k, v]) => [k, Array.isArray(v) ? v.slice(0, NS) : v]));
  const M = FC.meta;
  const idx = k => FC.months.indexOf(k);
  const iV0 = idx("2012-02"), iVend = idx(M.viirs_last_full), iAqua = idx("2002-07"), iTrainEnd = idx("2018-12");
  const col = { modis: "var(--s1)", viirs: "var(--s2)", harm: "var(--ink)" };
  const mR = FC.roll12(S.modis_raw), vR = FC.roll12(S.viirs_raw), hR = FC.roll12(S.harmonized);

  // headline numbers, all computed from the data
  const total = d3.sum(S.harmonized);
  const ratio = d3.sum(S.viirs_raw.slice(iV0, iVend + 1)) / d3.sum(S.modis_raw.slice(iV0, iVend + 1));
  const splice = FC.roll12(S.modis_raw.map((v, i) => (i < iV0 ? v : S.viirs_raw[i])));
  document.querySelectorAll("[data-fill=ratio]").forEach(e => { e.textContent = ratio.toFixed(1) + "×"; });
  $("facts").innerHTML = [
    [`${(FC.Mo / 12).toFixed(0)} years`, `${FC.monthLabel(0)} to ${FC.monthLabel(FC.Mo - 1)}`],
    [FC.fmt(total), "fire cell-days in the record"],
    [FC.fmt(FC.T), "0.25° map tiles with fire"],
  ].map(([b, s]) => `<div class="fact"><b>${b}</b><span>${s}</span></div>`).join("");
  const loaded = M.coverage.filter(c => c.loaded).map(c => c.name.replace(/_/g, " "));
  $("coverage-note").textContent = `Loaded: ${loaded.join(", ")}. The map and the pipeline cover the whole world; other regions are added as their data arrives.`;

  FC.drawCalendar($("hero-cal"), FC.areaSeries(FC.allTiles), { mode: "count", onPick: () => { location.href = "explore.html"; }, legend: document.createElement("div") });
  const title = (a, b, c) => { $(a).textContent = b; $(c).textContent = ""; };
  const unit = "fire cell-days, trailing 12 months";
  const sub = (id, t) => { $(id).textContent = t; };

  // ---- problem ----
  const P = FC.lineChart($("chart-problem"), { height: 380, label: "MODIS and VIIRS twelve-month fire totals" });
  const pOpt = { yLabel: unit, yFormat: FC.fmt, tipTitle: i => `12 months to ${FC.monthLabel(i)}` };
  const modis = (o = {}) => ({ id: "m", label: "MODIS (Terra + Aqua)", endLabel: "MODIS", color: col.modis, values: mR, ...o });
  const viirs = (o = {}) => ({ id: "v", label: "VIIRS (Suomi NPP)", endLabel: "VIIRS", color: col.viirs, values: vR, from: iV0 + 11, ...o });
  const naive = { id: "n", label: "MODIS, then VIIRS from 2012", endLabel: "joined raw", color: col.harm, dash: "5 4", width: 2.2, values: splice, from: 11 };
  const sceneP = [
    () => { title("p-title", "Monthly fire activity, MODIS", "p-sub"); sub("p-sub", "Region: all loaded data. Each point is the previous twelve months."); P.draw([modis()], pOpt); },
    () => { title("p-title", "The same ground, two sensors", "p-sub"); sub("p-sub", "VIIRS runs above MODIS from the day it starts."); P.draw([modis(), viirs()], { ...pOpt, marks: [{ date: FC.date[iV0], label: "VIIRS starts", top: 6 }] }); },
    () => { title("p-title", "What a naive join shows", "p-sub"); sub("p-sub", `The level steps up about ${ratio.toFixed(1)}× at the join, from the sensor change alone.`); P.draw([{ ...modis(), opacity: .35, endLabel: null }, { ...viirs(), opacity: .35, endLabel: null }, naive], { ...pOpt, marks: [{ date: FC.date[iV0], label: "join", top: 6 }] }); },
  ];

  // ---- harmonize ----
  const Hc = FC.lineChart($("chart-harmonize-line"), { height: 380, label: "Harmonized twelve-month fire totals" });
  const Sc = FC.scatterChart($("chart-harmonize-scatter"), { height: 380, label: "Monthly VIIRS counts against MODIS counts" });
  const hOpt = { yLabel: "fire cell-days, trailing 12 months (VIIRS-equivalent)", yFormat: FC.fmt, tipTitle: i => `12 months to ${FC.monthLabel(i)}` };
  const harm = (o = {}) => ({ id: "h", label: "Harmonized", endLabel: "harmonized", color: col.harm, width: 2.6, values: hR, from: 11, ...o });
  const trainIdx = d3.range(iV0, iTrainEnd + 1), testIdx = d3.range(iTrainEnd + 1, iVend + 1);
  const kfit = d3.sum(trainIdx, i => S.viirs_raw[i]) / d3.sum(trainIdx, i => S.modis_raw[i]);
  const pts = i => ({ x: S.modis_raw[i], y: S.viirs_raw[i], label: FC.monthLabel(i), color: i <= iTrainEnd ? col.modis : col.viirs });
  const maxXY = d3.max([...trainIdx, ...testIdx], i => Math.max(S.modis_raw[i], S.viirs_raw[i]));
  const show = which => { $("chart-harmonize-line").hidden = which !== "line"; $("chart-harmonize-scatter").hidden = which !== "scatter"; };
  const sceneH = [
    () => { show("line"); title("h-title", "Both sensors, same unit", "h-sub"); sub("h-sub", "Cell-days per month, summed over the region."); Hc.draw([modis(), viirs()], { ...hOpt, yLabel: unit, marks: [{ date: FC.date[iV0], label: "overlap begins", top: 6 }] }); },
    () => {
      show("scatter"); title("h-title", "Monthly counts, 2012 to now", "h-sub"); sub("h-sub", `Each dot is one month. VIIRS is about ${kfit.toFixed(1)}× MODIS on the training months.`);
      Sc.draw({ xName: "MODIS cell-days in the month", yName: "VIIRS cell-days in the month", max: maxXY, points: [...trainIdx, ...testIdx].map(pts),
        groups: [{ label: "Fitted on 2012 to 2018", color: col.modis }, { label: "Held back: 2019 onward", color: col.viirs }],
        lines: [{ x0: 0, y0: 0, x1: maxXY, y1: maxXY, dash: "4 4", label: "equal counts" }, { x0: 0, y0: 0, x1: maxXY / kfit, y1: maxXY, label: `VIIRS ≈ ${kfit.toFixed(1)} × MODIS`, color: col.harm }] });
    },
    () => { show("line"); title("h-title", "MODIS history rescaled", "h-sub"); sub("h-sub", "Dark line: the harmonized record. Faint lines: the raw sensors."); Hc.draw([{ ...modis(), opacity: .35, endLabel: null }, { ...viirs(), opacity: .35, endLabel: null }, harm({ to: iV0 + 6 })], { ...hOpt, marks: [{ date: FC.date[iAqua], label: "Aqua joins", top: 6 }] }); },
    () => {
      show("line"); title("h-title", "One record, 2000 to now", "h-sub"); sub("h-sub", "Shaded by where each stretch comes from.");
      Hc.draw([{ ...modis(), opacity: .18, endLabel: null }, { ...viirs(), opacity: .18, endLabel: null }, harm()], { ...hOpt,
        bands: [{ from: 0, to: iAqua - 1, label: " ", fill: "var(--surface-2)" }, { from: iAqua, to: iV0 - 1, label: "MODIS rescaled (Terra only before mid-2002)", fill: "transparent" }, { from: iV0, to: iVend, label: "VIIRS", fill: "var(--surface-2)" }] });
    },
  ];

  function bind(sectionId, scenes) {
    const els = [...document.querySelectorAll(`#${sectionId} .step`)];
    let cur = -1;
    const set = i => { if (i === cur) return; cur = i; els.forEach((e, k) => e.classList.toggle("active", k === i)); scenes[i](); };
    set(0);
    const io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) set(els.indexOf(e.target)); }), { rootMargin: "-45% 0px -45% 0px" });
    els.forEach(e => io.observe(e));
  }
  bind("problem", sceneP);
  bind("harmonize", sceneH);
  FC.onTheme(() => { cur_refresh(); });
  function cur_refresh() { const a = document.querySelector("#problem .step.active"), b = document.querySelector("#harmonize .step.active"); if (a) sceneP[+a.dataset.step](); if (b) sceneH[+b.dataset.step](); }

  // ---- validation ----
  const cal = M.calibration, met = cal.metrics_on_test, best = met[M.model], raw = met.raw_modis_no_calibration;
  $("validation-sub").textContent = `The calibration was fitted on ${cal.train.replace("..", " to ")} and scored on ${cal.test.replace("..", " to ")}.`;
  $("v-sub").textContent = "Monthly totals for the whole region, held-back months only.";
  const i0 = iTrainEnd + 1;
  const V = FC.lineChart($("chart-validate"), { height: 320, label: "Rescaled MODIS against VIIRS on held-back months" });
  V.draw([
    { id: "m", label: "MODIS, unscaled", color: col.modis, values: S.modis_raw, from: i0, to: iVend, opacity: .45, width: 1.6, endLabel: null },
    { id: "v", label: "VIIRS observed", color: col.viirs, values: S.viirs_raw, from: i0, to: iVend, width: 2.2, endLabel: null },
    { id: "c", label: "MODIS rescaled", color: col.harm, values: S.modis_cal, from: i0, to: iVend, width: 2.2, dash: "5 3", endLabel: null },
  ], { xDomain: [FC.date[i0], FC.date[iVend]], yFormat: FC.fmt, yLabel: "fire cell-days per month", endLabels: false });
  const f1 = d3.format(".1f"), f2 = d3.format(".2f");
  $("score").innerHTML = [
    ["Share of month-to-month variation explained (R²)", f2(raw.region_r2), f2(best.region_r2)],
    ["Typical monthly error (MAPE)", f1(raw.region_mape_pct) + "%", f1(best.region_mape_pct) + "%"],
    ["Bias over the period", f1(raw.region_bias_pct) + "%", f1(best.region_bias_pct) + "%"],
  ].map(([k, a, b]) => `<div class="row"><div class="k">${k}</div><div class="v"><s>${a}</s><span aria-hidden="true">→</span><b>${b}</b></div></div>`).join("");

  // ---- continuity after Suomi NPP ----
  const n = cal.noaa, i1 = iVend, i21 = idx("2021-01");
  $("continuity-sub").textContent = `Suomi NPP stopped delivering new data on 2 November 2026. NOAA-20 and NOAA-21 carry the same kind of sensor, so each is rescaled to Suomi NPP on the months they share. The record continues from NOAA-20.`;
  $("c-sub").textContent = "Monthly totals for the whole region. Both NOAA satellites fly alongside Suomi NPP.";
  FC.lineChart($("chart-continuity"), { height: 320, label: "NOAA-20 and NOAA-21 rescaled against Suomi NPP" }).draw([
    { id: "s", label: "Suomi NPP observed", color: "var(--s2)", values: S.viirs_raw, from: i21, to: i1, width: 2.4, endLabel: null },
    { id: "a", label: "NOAA-20 rescaled", color: "var(--s1)", values: S.noaa20_cal, from: i21, to: i1, width: 1.8, dash: "5 3", endLabel: null },
    { id: "b", label: "NOAA-21 rescaled", color: "var(--s3)", values: S.noaa21_cal, from: i21, to: i1, width: 1.8, dash: "2 3", endLabel: null },
  ], { xDomain: [FC.date[i21], FC.date[i1]], yFormat: FC.fmt, yLabel: "fire cell-days per month", endLabels: false });
  const nb = k => n[k].metrics_on_test[n[k].model], nr = k => n[k].metrics_on_test.raw_no_calibration;
  $("score-noaa").innerHTML = [["NOAA-20", "VIIRS_NOAA20"], ["NOAA-21", "VIIRS_NOAA21"]].map(([label, k]) =>
    `<div class="row"><div class="k">${label}: error on held-back months (MAPE)</div><div class="v"><b>${f1(nb(k).region_mape_pct)}%</b><em>R² ${f2(nb(k).region_r2)}, bias ${f1(nb(k).region_bias_pct)}%</em></div></div>`).join("")
    + `<div class="row"><div class="k">For comparison, MODIS rescaled</div><div class="v"><b>${f1(best.region_mape_pct)}%</b><em>R² ${f2(best.region_r2)}, bias ${f1(best.region_bias_pct)}%</em></div></div>`;
  const pa = FC.partial, a20 = pa && FC.series.noaa20_cal[FC.partialIdx], a21 = pa && FC.series.noaa21_cal[FC.partialIdx];
  $("continuity-note").textContent = pa
    ? `The newest month, ${FC.monthLabel(FC.partialIdx)}, is counted from NOAA-20 and is still running; the explorer compares it with a pro-rated normal. NOAA-21 counts ${Math.abs(Math.round((a21 / a20 - 1) * 100))}% ${a21 < a20 ? "less" : "more"} than NOAA-20 on the same days.`
    : "";
})();
