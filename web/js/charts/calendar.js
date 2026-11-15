// Burning calendar: a year x month grid, annual totals on the right, the typical year underneath.
FC.drawCalendar = function (el, vals, o) {
  const years = FC.years, cw = 27, ch = 14, ml = 34, mt = 20, mr = 62, gap = 1.5;
  const gridH = ch * years.length, W = ml + cw * 12 + mr + 6, H = mt + gridH + 56;
  const svg = d3.select(el).html("").append("svg").attr("viewBox", `0 0 ${W} ${H}`).attr("width", "100%").style("display", "block")
    .attr("role", "img").attr("aria-label", "Burning calendar, fire cell-days by year and month");
  const anomaly = o.mode === "anomaly";
  const cap = d3.quantile(Array.from(vals).filter(v => v > 0).sort(d3.ascending), 0.98) || 1;
  const cells = d3.range(FC.Mo).map(m => ({ m, v: vals[m], a: anomaly ? FC.anomaly(vals, m) : null }));
  const fill = d => anomaly ? (d.a === null ? "var(--surface-2)" : FC.diverge(d.a)) : (d.v <= 0 ? "var(--surface-2)" : FC.heat(d.v / cap));

  svg.selectAll(".mh").data(FC.monthNames).join("text").attr("x", (d, i) => ml + i * cw + cw / 2).attr("y", 12).attr("text-anchor", "middle")
    .style("fill", "var(--muted)").style("font", "9px var(--font)").text(d => d);
  svg.selectAll(".yl").data(years).join("text").attr("x", ml - 6).attr("text-anchor", "end").attr("y", y => mt + (y - years[0]) * ch + ch / 2 + 3.5)
    .style("fill", "var(--muted)").style("font", "9.5px var(--font)").style("font-variant-numeric", "tabular-nums").text(y => (y % 2 === 0 ? y : "")); 

  const g = svg.append("g");
  g.selectAll("rect").data(cells).join("rect").attr("x", d => ml + FC.cal[d.m] * cw + gap / 2).attr("y", d => mt + (FC.year[d.m] - years[0]) * ch + gap / 2)
    .attr("width", cw - gap).attr("height", ch - gap).attr("rx", 2).attr("fill", fill)
    .attr("opacity", d => (FC.meta.source[d.m] === "modis_terra" ? 0.5 : FC.isPartial(d.m) ? 0.6 : 1)).style("cursor", "pointer")
    .on("click", (e, d) => o.onPick(d.m))
    .on("pointermove", (e, d) => {
      const an = FC.anomaly(vals, d.m), rk = FC.rankOfMonth(vals, d.m);
      const src = { viirs: "VIIRS", noaa20: "NOAA-20, rescaled", modis: "MODIS, rescaled", modis_terra: "Terra only, rescaled" }[FC.meta.source[d.m]];
      FC.tip.show(e, FC.monthLabel(d.m), [
        { label: "Fire cell-days", value: FC.fmt(d.v) },
        ...(an === null ? [] : [{ label: "Versus normal", value: (an >= 0 ? "+" : "") + Math.round(an * 100) + "%" }]),
        rk ? { label: `Rank among ${FC.longMonths[FC.cal[d.m]]}s`, value: `${rk.rank} of ${rk.of}` } : { label: "Month in progress", value: "pro-rated normal" },
        { label: "Source", value: src },
      ]);
    }).on("pointerleave", () => FC.tip.hide());

  // the join to VIIRS
  const v0 = FC.meta.source.indexOf("viirs");
  if (v0 > 0) {
    const y = mt + (FC.year[v0] - years[0]) * ch + (FC.cal[v0] === 0 ? 0 : ch);
    svg.append("line").attr("x1", ml).attr("x2", ml + cw * 12).attr("y1", y).attr("y2", y).attr("stroke", "var(--ink-2)").attr("stroke-width", 1);
  }
  const ring = svg.append("rect").attr("width", cw).attr("height", ch).attr("rx", 3).attr("fill", "none").attr("stroke", "var(--ink)").attr("stroke-width", 2).style("pointer-events", "none");
  const setSelected = m => { if (m != null) ring.attr("x", ml + FC.cal[m] * cw).attr("y", mt + (FC.year[m] - years[0]) * ch); };
  setSelected(o.selected);

  // annual totals (thin bars)
  const tot = years.map(y => d3.sum(d3.range(FC.Mo).filter(k => FC.year[k] === y), k => vals[k]));
  const tx = d3.scaleLinear().domain([0, d3.max(tot) || 1]).range([0, mr - 10]);
  svg.selectAll(".tb").data(years).join("rect").attr("x", ml + cw * 12 + 10).attr("y", y => mt + (y - years[0]) * ch + 3.5).attr("height", ch - 7).attr("rx", 1.5)
    .attr("width", (y, i) => Math.max(0.5, tx(tot[i]))).attr("fill", "var(--ink-2)").attr("opacity", .55)
    .on("pointermove", (e, y) => FC.tip.show(e, String(y), [{ label: "Fire cell-days in the year", value: FC.fmt(tot[years.indexOf(y)]) }])).on("pointerleave", () => FC.tip.hide());
  svg.append("text").attr("x", ml + cw * 12 + 10).attr("y", 12).style("fill", "var(--muted)").style("font", "10px var(--font)").text("per year");

  // typical year: median by calendar month
  const med = d3.range(12).map(c => d3.median(FC.byCal[c].map(k => vals[k])));
  const by = d3.scaleLinear().domain([0, d3.max(med) || 1]).range([0, 32]), base = mt + gridH + 44;
  svg.selectAll(".mb").data(med).join("rect").attr("x", (d, i) => ml + i * cw + 4).attr("width", cw - 8).attr("y", d => base - by(d)).attr("height", d => Math.max(0.5, by(d)))
    .attr("rx", 1.5).attr("fill", "var(--ink-2)").attr("opacity", .55)
    .on("pointermove", (e, d) => { const i = med.indexOf(d); FC.tip.show(e, "Typical " + FC.longMonths[i], [{ label: "Median fire cell-days", value: FC.fmt(d) }]); }).on("pointerleave", () => FC.tip.hide());
  svg.append("text").attr("x", ml).attr("y", base + 12).style("fill", "var(--muted)").style("font", "10px var(--font)").text("typical month (median across years)");

  if (anomaly) FC.scaleBar(o.legend, t => FC.diverge(t * 2 - 1), "−100% below normal", "+100% above");
  else FC.scaleBar(o.legend, t => FC.heat(t * t), "0", `${FC.fmt(cap)}+ fire cell-days a month`);
  const note = document.createElement("span"); note.style.flexBasis = "100%"; note.textContent = "Line: VIIRS starts here. Faded: Terra-only rows and the month in progress.";
  o.legend.append(note);
  return { setSelected };
};

// every month as a table row, for readers who prefer numbers
FC.calendarTable = function (host, vals) {
  host.html("");
  const t = host.append("table");
  t.append("thead").append("tr").selectAll("th").data(["Year", ...FC.monthNames, "Total"]).join("th").text(d => d);
  t.append("tbody").selectAll("tr").data(FC.years).join("tr").each(function (y) {
    const row = FC.monthNames.map((_, c) => { const k = FC.months.indexOf(`${y}-${String(c + 1).padStart(2, "0")}`); return k < 0 ? "" : FC.fmt(vals[k]); });
    const tot = d3.sum(FC.months.map((m, k) => (FC.year[k] === y ? vals[k] : 0)));
    d3.select(this).selectAll("td").data([y, ...row, FC.fmt(tot)]).join("td").text(d => d);
  });
};
