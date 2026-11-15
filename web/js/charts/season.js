// Seasonal profile: typical month, the middle 80% of years, and the chosen year.
FC.drawSeason = function (el, vals, selected) {
  let curYear = FC.year[selected], dot = null, curX = null, curY = null, curCur = null;
  const W = 420, H = 190, m = { t: 12, r: 12, b: 24, l: 44 };
  const svg = d3.select(el).html("").append("svg").attr("viewBox", `0 0 ${W} ${H}`).attr("width", "100%").style("display", "block")
    .attr("role", "img").attr("aria-label", "Seasonal profile of fire activity");
  const per = d3.range(12).map(c => FC.byCal[c].map(k => vals[k]).sort(d3.ascending));
  const med = per.map(a => d3.median(a)), lo = per.map(a => d3.quantile(a, 0.1)), hi = per.map(a => d3.quantile(a, 0.9));
  const yr = curYear;
  const cur = d3.range(12).map(c => { const k = FC.months.indexOf(`${yr}-${String(c + 1).padStart(2, "0")}`); return k < 0 ? null : vals[k]; });
  const x = d3.scalePoint().domain(d3.range(12)).range([m.l, W - m.r]).padding(0.4);
  const y = d3.scaleLinear().domain([0, d3.max([...hi, ...cur.filter(v => v !== null)]) || 1]).nice().range([H - m.b, m.t]);
  svg.append("g").attr("class", "grid").selectAll("line").data(y.ticks(4)).join("line").attr("x1", m.l).attr("x2", W - m.r).attr("y1", d => y(d)).attr("y2", d => y(d));
  svg.append("g").attr("class", "axis").attr("transform", `translate(0,${H - m.b})`).call(d3.axisBottom(x).tickFormat(i => FC.monthNames[i][0]).tickSize(0).tickPadding(8));
  svg.append("g").attr("class", "axis").attr("transform", `translate(${m.l},0)`).call(d3.axisLeft(y).ticks(4).tickFormat(d3.format("~s")).tickSize(0).tickPadding(6));
  svg.append("path").attr("fill", "var(--s1)").attr("opacity", .16).attr("d", d3.area().x((d, i) => x(i)).y0((d, i) => y(lo[i])).y1((d, i) => y(hi[i])).curve(d3.curveMonotoneX)(med));
  svg.append("path").attr("fill", "none").attr("stroke", "var(--s1)").attr("stroke-width", 2).attr("d", d3.line().x((d, i) => x(i)).y(d => y(d)).curve(d3.curveMonotoneX)(med));
  svg.append("path").attr("fill", "none").attr("stroke", "var(--s2)").attr("stroke-width", 2.4).attr("d", d3.line().defined(d => d !== null).x((d, i) => x(i)).y(d => y(d)).curve(d3.curveMonotoneX)(cur));
  dot = svg.append("circle").attr("r", 4.5).attr("fill", "var(--s2)").attr("stroke", "var(--surface)").attr("stroke-width", 2).style("pointer-events", "none");
  curX = x; curY = y; curCur = cur;
  const place = m => { const c = FC.cal[m]; if (curCur[c] === null) dot.style("display", "none"); else dot.style("display", null).attr("cx", curX(c)).attr("cy", curY(curCur[c])); };
  place(selected);
  svg.append("rect").attr("x", m.l).attr("y", m.t).attr("width", W - m.l - m.r).attr("height", H - m.t - m.b).attr("fill", "transparent")
    .on("pointermove", ev => {
      const i = d3.least(d3.range(12), k => Math.abs(x(k) - d3.pointer(ev)[0]));
      FC.tip.show(ev, FC.longMonths[i], [{ color: "var(--s2)", label: String(yr), value: cur[i] == null ? "none" : FC.fmt(cur[i]) },
        { color: "var(--s1)", label: "Typical (median)", value: FC.fmt(med[i]) }, { label: "Middle 80% of years", value: `${FC.fmt(lo[i])} to ${FC.fmt(hi[i])}` }]);
    }).on("pointerleave", () => FC.tip.hide());
  const lg = d3.select(el).insert("div", "svg").attr("class", "legend-row");
  lg.html(`<span><i style="background:var(--s2)"></i>${yr}</span><span><i style="background:var(--s1)"></i>Typical month</span><span><i style="background:var(--s1);opacity:.3;height:9px"></i>Middle 80% of years</span>`);
  return {
    setSelected(m) { if (FC.year[m] !== curYear) FC.drawSeason(el, vals, m).setSelected(m); else place(m); },
    year: () => curYear,
  };
};
