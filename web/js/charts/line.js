// Multi-series time-series chart on the shared monthly axis: thin lines, quiet grid, a legend,
// selective end labels, a crosshair with one tooltip for all series, and a data table.
FC.lineChart = function (el, o = {}) {
  const W = o.width || 760, H = o.height || 360, m = { t: 14, r: o.endLabels === false ? 18 : (W < 500 ? 46 : 92), b: 28, l: 46 };
  el.replaceChildren();
  const legend = d3.select(el).append("div").attr("class", "legend-row");
  const svg = d3.select(el).append("svg").attr("viewBox", `0 0 ${W} ${H}`).attr("width", "100%")
    .style("display", "block").attr("role", "img").attr("aria-label", o.label || "Time series");
  const x = d3.scaleTime().range([m.l, W - m.r]);
  const y = d3.scaleLinear().range([H - m.b, m.t]);
  const bandsG = svg.append("g"), grid = svg.append("g").attr("class", "grid");
  const gx = svg.append("g").attr("class", "axis").attr("transform", `translate(0,${H - m.b})`);
  const gy = svg.append("g").attr("class", "axis").attr("transform", `translate(${m.l},0)`);
  const marksG = svg.append("g"), linesG = svg.append("g"), endG = svg.append("g"), hoverG = svg.append("g").style("pointer-events", "none");
  const cross = hoverG.append("line").attr("stroke", "var(--ink-2)").attr("stroke-width", 1).attr("y1", m.t).attr("y2", H - m.b).style("display", "none");
  const dots = hoverG.append("g");
  const yTitle = svg.append("text").attr("x", m.l).attr("y", m.t - 3).attr("class", "axis").style("fill", "var(--muted)").style("font", "11px var(--font)");
  const tableHost = d3.select(el).append("details").attr("class", "tbl");
  tableHost.append("summary").text("View as table");
  const tableWrap = tableHost.append("div").attr("class", "wrap");
  let cur = { spec: [], opt: {} };
  const fmt = v => (cur.opt.yFormat || FC.fmt)(v);

  const hit = svg.append("rect").attr("x", m.l).attr("y", m.t).attr("width", W - m.l - m.r).attr("height", H - m.t - m.b)
    .attr("fill", "transparent").style("cursor", "crosshair");
  hit.on("pointermove", ev => {
    const [px] = d3.pointer(ev, svg.node());
    const t = x.invert(px);
    let i = d3.bisector(d => d).center(FC.date, t);
    const rows = cur.spec.filter(s => (s.opacity ?? 1) > .05 && s.values[i] != null && i >= (s.from ?? 0) && i <= (s.to ?? FC.Mo - 1));
    if (!rows.length) { cross.style("display", "none"); dots.selectAll("*").remove(); FC.tip.hide(); return; }
    cross.style("display", null).attr("x1", x(FC.date[i])).attr("x2", x(FC.date[i]));
    dots.selectAll("circle").data(rows, d => d.id).join("circle").attr("r", 4).attr("fill", d => d.color)
      .attr("stroke", "var(--surface)").attr("stroke-width", 2).attr("cx", x(FC.date[i])).attr("cy", d => y(d.values[i]));
    const title = cur.opt.tipTitle ? cur.opt.tipTitle(i) : FC.monthLabel(i);
    FC.tip.show(ev, title, rows.filter(r => r.label).map(r => ({ color: r.color, label: r.label, value: fmt(r.values[i]) })));
  }).on("pointerleave", () => { cross.style("display", "none"); dots.selectAll("*").remove(); FC.tip.hide(); });

  function draw(spec, opt = {}) {
    cur = { spec, opt };
    const dur = opt.instant ? 0 : 420;
    x.domain(opt.xDomain || d3.extent(FC.date));
    const ymax = opt.yMax || d3.max(spec, s => d3.max(s.values.filter(v => v != null))) || 1;
    y.domain([0, ymax]).nice();
    gx.transition().duration(dur).call(d3.axisBottom(x).ticks(W > 500 ? 9 : 5).tickSizeOuter(0));
    gy.transition().duration(dur).call(d3.axisLeft(y).ticks(5).tickFormat(opt.axisFormat || d3.format("~s")).tickSize(0).tickPadding(8));
    grid.selectAll("line").data(y.ticks(5)).join("line").attr("x1", m.l).attr("x2", W - m.r)
      .transition().duration(dur).attr("y1", d => y(d)).attr("y2", d => y(d));
    yTitle.text(opt.yLabel || "");

    bandsG.selectAll("g").data(opt.bands || [], d => d.label).join(enter => {
      const g = enter.append("g");
      g.append("rect"); g.append("text").style("fill", "var(--muted)").style("font", "11px var(--font)");
      return g;
    }).each(function (d, k) {
      const g = d3.select(this), x0 = x(FC.date[d.from]), x1 = x(FC.date[Math.min(d.to, FC.Mo - 1)]);
      g.select("rect").attr("x", x0).attr("width", Math.max(0, x1 - x0)).attr("y", m.t).attr("height", H - m.t - m.b)
        .attr("fill", d.fill || "var(--surface-2)").attr("opacity", d.opacity ?? 1);
      g.select("text").attr("x", x0 + 6).attr("y", m.t + 13).text(d.label);
    });
    marksG.selectAll("g").data(opt.marks || [], d => d.label).join(enter => {
      const g = enter.append("g");
      g.append("line").attr("stroke", "var(--ink-2)").attr("stroke-width", 1);
      g.append("text").style("fill", "var(--ink-2)").style("font", "11px var(--font)");
      return g;
    }).each(function (d) {
      const g = d3.select(this), px = x(d.date);
      g.select("line").attr("x1", px).attr("x2", px).attr("y1", m.t + (d.top ?? 20)).attr("y2", H - m.b);
      g.select("text").attr("x", px - 6).attr("text-anchor", "end").attr("y", m.t + (d.top ?? 20) + 3).text(d.label);
    });

    const line = d3.line().defined(d => d != null).x((d, i) => x(FC.date[i])).y(d => y(d)).curve(d3.curveMonotoneX);
    linesG.selectAll("path").data(spec, d => d.id).join(
      e => e.append("path").attr("fill", "none").attr("stroke-linejoin", "round").attr("stroke-linecap", "round").style("opacity", 0),
      u => u,
      x0 => x0.transition().duration(dur).style("opacity", 0).remove(),
    ).attr("stroke", d => d.color).attr("stroke-width", d => d.width || 2).attr("stroke-dasharray", d => d.dash || null)
      .attr("d", d => line(d.values.map((v, i) => (i >= (d.from ?? 0) && i <= (d.to ?? FC.Mo - 1) ? v : null))))
      .transition().duration(dur).style("opacity", d => d.opacity ?? 1);

    // legend + selective end labels (no number on every point)
    const vis = spec.filter(s => (s.opacity ?? 1) > .05 && s.label);
    legend.selectAll("span").data(vis, d => d.id).join("span").each(function (d) {
      this.replaceChildren(Object.assign(document.createElement("i"), { style: `background:${d.color}${d.dash ? ";opacity:.7" : ""}` }), document.createTextNode(d.label));
    });
    const ends = opt.endLabels === false ? [] : vis.map(s => {
      let i = Math.min(s.to ?? FC.Mo - 1, FC.Mo - 1);
      while (i >= (s.from ?? 0) && s.values[i] == null) i--;
      return { s, i, py: y(s.values[i]) };
    }).filter(e => e.i >= 0 && e.s.values[e.i] != null).sort((a, b) => a.py - b.py);
    for (let k = 1; k < ends.length; k++) ends[k].py = Math.max(ends[k].py, ends[k - 1].py + 15);
    endG.selectAll("text").data(ends, d => d.s.id).join("text").style("fill", "var(--ink)").style("font", "600 11.5px var(--font)")
      .attr("dy", "0.32em").attr("x", d => x(FC.date[d.i]) + 8).transition().duration(dur).attr("y", d => d.py)
      .text(d => (d.s.endLabel || fmt(d.s.values[d.i])));

    // table: value at each December plus the latest month
    const idx = d3.range(FC.Mo).filter(i => FC.cal[i] === 11 || i === FC.Mo - 1);
    const shown = vis.filter(s => s.label);
    const rows = idx.map(i => [FC.monthLabel(i), ...shown.map(s => (s.values[i] == null || i < (s.from ?? 0) || i > (s.to ?? FC.Mo - 1) ? "" : fmt(s.values[i])))]);
    tableWrap.html("");
    const t = tableWrap.append("table");
    t.append("thead").append("tr").selectAll("th").data(["Month", ...shown.map(s => s.label)]).join("th").text(d => d);
    t.append("tbody").selectAll("tr").data(rows).join("tr").selectAll("td").data(d => d).join("td").text(d => d);
  }
  return { draw, x, y };
};
