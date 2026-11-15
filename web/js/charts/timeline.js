// Timeline under the map: the area's monthly fire activity, click or drag to choose a month.
// The curve is built when the data or size changes; moving the month only moves the playhead.
FC.createTimeline = function (el, o) {
  const svg = d3.select(el).append("svg").style("display", "block").style("width", "100%").style("height", "100%").style("touch-action", "none")
    .attr("role", "img").attr("aria-label", "Monthly fire activity timeline; click to choose a month");
  let vals = new Float64Array(FC.Mo), sel = FC.Mo - 1, built = null, dragging = false, w = 600, h = 80;
  const m = { t: 8, r: 8, b: 18, l: 8 };
  const x = d3.scaleLinear().domain([0, FC.Mo - 1]), y = d3.scaleLinear();
  let head, dot;

  function build() {
    const r = el.getBoundingClientRect(); w = r.width; h = r.height;
    if (!w || !h) return;
    svg.attr("viewBox", `0 0 ${w} ${h}`);
    x.range([m.l, w - m.r]); y.range([h - m.b, m.t]).domain([0, d3.max(vals) || 1]);
    svg.selectAll("*").remove();
    const v0 = FC.meta.source.indexOf("viirs"), a0 = FC.meta.source.indexOf("modis");
    svg.append("rect").attr("x", x(0)).attr("width", x(a0) - x(0)).attr("y", m.t).attr("height", h - m.t - m.b).attr("fill", "var(--surface-2)");
    svg.append("path").attr("d", d3.area().x((d, i) => x(i)).y0(y(0)).y1(d => y(d)).curve(d3.curveMonotoneX)(vals)).attr("fill", "var(--accent)").attr("opacity", .22);
    svg.append("path").attr("d", d3.line().x((d, i) => x(i)).y(d => y(d)).curve(d3.curveMonotoneX)(vals)).attr("fill", "none").attr("stroke", "var(--accent)").attr("stroke-width", 1.6);
    const yrs = d3.range(FC.years[0] + (FC.cal[0] === 0 ? 0 : 1), FC.years[FC.years.length - 1] + 1, 4);
    svg.selectAll(".tk").data(yrs).join("text").attr("x", yr => x(FC.months.indexOf(`${yr}-01`))).attr("y", h - 4).attr("text-anchor", "middle")
      .style("fill", "var(--muted)").style("font", "10px var(--font)").text(d => d);
    if (v0 > 0) svg.append("line").attr("x1", x(v0)).attr("x2", x(v0)).attr("y1", m.t).attr("y2", h - m.b).attr("stroke", "var(--line-2)").attr("stroke-dasharray", "2 3");
    head = svg.append("line").attr("y1", m.t).attr("y2", h - m.b).attr("stroke", "var(--ink)").attr("stroke-width", 1.5);
    dot = svg.append("circle").attr("r", 5).attr("fill", "var(--accent)").attr("stroke", "var(--surface)").attr("stroke-width", 2);
    built = { vals, w, h };
    place();
  }
  function place() { head.attr("x1", x(sel)).attr("x2", x(sel)); dot.attr("cx", x(sel)).attr("cy", y(vals[sel])); }

  const at = ev => Math.max(0, Math.min(FC.Mo - 1, Math.round(x.invert(d3.pointer(ev, svg.node())[0]))));
  svg.on("pointerdown", ev => { dragging = true; svg.node().setPointerCapture(ev.pointerId); o.onPick(at(ev)); })
    .on("pointermove", ev => {
      const i = at(ev); if (dragging) o.onPick(i);
      const an = FC.anomaly(vals, i);
      FC.tip.show(ev, FC.monthLabel(i), [{ label: "Fire cell-days", value: FC.fmt(vals[i]) }, ...(an === null ? [] : [{ label: "Versus normal", value: (an >= 0 ? "+" : "") + Math.round(an * 100) + "%" }])]);
    })
    .on("pointerup", () => { dragging = false; }).on("pointerleave", () => FC.tip.hide());
  new ResizeObserver(() => { const r = el.getBoundingClientRect(); if (!built || r.width !== built.w || r.height !== built.h) build(); }).observe(el);
  return {
    set(v, s) {
      vals = v; sel = s;
      if (!built || built.vals !== v) build(); else place();
    },
  };
};
