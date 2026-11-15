// Scatter with a nearest-point hover layer, reference lines and a legend.
FC.scatterChart = function (el, o = {}) {
  const W = 760, H = o.height || 380, m = { t: 16, r: 24, b: 44, l: 62 };
  el.replaceChildren();
  const legend = d3.select(el).append("div").attr("class", "legend-row");
  const svg = d3.select(el).append("svg").attr("viewBox", `0 0 ${W} ${H}`).attr("width", "100%").style("display", "block")
    .attr("role", "img").attr("aria-label", o.label || "Scatter chart");
  const x = d3.scaleLinear().range([m.l, W - m.r]), y = d3.scaleLinear().range([H - m.b, m.t]);
  const grid = svg.append("g").attr("class", "grid");
  const gx = svg.append("g").attr("class", "axis").attr("transform", `translate(0,${H - m.b})`);
  const gy = svg.append("g").attr("class", "axis").attr("transform", `translate(${m.l},0)`);
  const lines = svg.append("g"), pts = svg.append("g"), hov = svg.append("g").style("pointer-events", "none");
  const xl = svg.append("text").attr("x", (m.l + W - m.r) / 2).attr("y", H - 6).attr("text-anchor", "middle").style("fill", "var(--muted)").style("font", "12px var(--font)");
  const yl = svg.append("text").attr("transform", `translate(14,${(m.t + H - m.b) / 2}) rotate(-90)`).attr("text-anchor", "middle").style("fill", "var(--muted)").style("font", "12px var(--font)");
  const hit = svg.append("rect").attr("x", m.l).attr("y", m.t).attr("width", W - m.l - m.r).attr("height", H - m.t - m.b).attr("fill", "transparent");
  let cur = null, del = null;
  hit.on("pointermove", ev => {
    if (!cur) return;
    const [px, py] = d3.pointer(ev, svg.node());
    const i = del.find(px, py);
    const p = cur.points[i];
    if (!p || Math.hypot(x(p.x) - px, y(p.y) - py) > 40) { hov.selectAll("*").remove(); FC.tip.hide(); return; }
    hov.selectAll("circle").data([p]).join("circle").attr("r", 7).attr("fill", "none").attr("stroke", "var(--ink)").attr("stroke-width", 2).attr("cx", x(p.x)).attr("cy", y(p.y));
    FC.tip.show(ev, p.label, [{ label: cur.xName, value: FC.fmt(p.x) }, { label: cur.yName, value: FC.fmt(p.y) }]);
  }).on("pointerleave", () => { hov.selectAll("*").remove(); FC.tip.hide(); });

  function draw(d) {
    cur = d;
    const max = d.max || d3.max(d.points, p => Math.max(p.x, p.y));
    x.domain([0, max]).nice(); y.domain([0, max]).nice();
    gx.call(d3.axisBottom(x).ticks(6).tickFormat(d3.format("~s")).tickSize(0).tickPadding(8));
    gy.call(d3.axisLeft(y).ticks(6).tickFormat(d3.format("~s")).tickSize(0).tickPadding(8));
    grid.selectAll("line").data(y.ticks(6)).join("line").attr("x1", m.l).attr("x2", W - m.r).attr("y1", v => y(v)).attr("y2", v => y(v));
    xl.text(d.xName); yl.text(d.yName);
    del = d3.Delaunay.from(d.points, p => x(p.x), p => y(p.y));
    pts.selectAll("circle").data(d.points).join("circle").attr("cx", p => x(p.x)).attr("cy", p => y(p.y)).attr("r", 4.5)
      .attr("fill", p => p.color).attr("fill-opacity", .85).attr("stroke", "var(--surface)").attr("stroke-width", 1.5);
    const L = lines.selectAll("g").data(d.lines || []).join(e => { const g = e.append("g"); g.append("line"); g.append("text"); return g; });
    L.select("line").attr("x1", l => x(l.x0)).attr("y1", l => y(l.y0)).attr("x2", l => x(l.x1)).attr("y2", l => y(l.y1))
      .attr("stroke", l => l.color || "var(--ink-2)").attr("stroke-width", 1.6).attr("stroke-dasharray", l => l.dash || null);
    L.select("text").attr("x", l => x(l.x1) - 6).attr("y", l => y(l.y1) - 8).attr("text-anchor", "end").style("fill", "var(--ink)").style("font", "600 11.5px var(--font)").text(l => l.label);
    legend.selectAll("span").data(d.groups).join("span").each(function (g) {
      this.replaceChildren(Object.assign(document.createElement("i"), { className: "dot", style: `background:${g.color}` }), document.createTextNode(g.label));
    });
  }
  return { draw };
};
