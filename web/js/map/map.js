// World map: canvas basemap + hexagon-binned fire tiles, SVG layer for tools and selection.
// Performance notes: the basemap is projected once into Path2D objects, hex membership is cached per
// zoom level, per-month sums are typed-array loops, and drawing is coalesced into one frame.
FC.createMap = async function (o) {
  const canvas = o.canvas, ctx = canvas.getContext("2d"), svg = d3.select(o.svg);
  const world = await fetch("vendor/countries-50m.json").then(r => r.json());
  const land = topojson.feature(world, world.objects.countries).features;
  const borders = topojson.mesh(world, world.objects.countries, (a, b) => a !== b);
  const countryOf = new Map(land.map(f => [f.properties.name, f]));
  const S = FC.meta.tile_size, SQ3 = Math.sqrt(3);
  const st = { metric: "density", month: FC.Mo - 1, tool: "pan", tr: d3.zoomIdentity, sel: null, w: 0, h: 0, dpr: 1 };
  let proj, TX, TY, tilePx, draft = null, landP, bordP, labels = [], countryP = new Map();
  let hex = null, vals = null, level = null, raf = 0, hoverEv = null, hoverRaf = 0, dimPath = null, col = {};
  const readColors = () => { col = { sea: FC.css("--sea"), land: FC.css("--land"), border: FC.css("--border"), scrim: FC.css("--scrim"), muted: FC.css("--muted") }; };
  const cal = FC.cal;

  const overlay = svg.append("g");
  const selPath = overlay.append("path").attr("fill", "none").attr("stroke", "var(--ink)").attr("stroke-width", 2).attr("vector-effect", "non-scaling-stroke");
  const draftPath = overlay.append("path").attr("fill", "var(--accent)").attr("fill-opacity", .1).attr("stroke", "var(--accent)").attr("stroke-width", 2).attr("vector-effect", "non-scaling-stroke");
  const draftDots = overlay.append("g");

  function layout() {
    const r = canvas.parentElement.getBoundingClientRect();
    st.w = r.width; st.h = r.height; st.dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(st.w * st.dpr); canvas.height = Math.round(st.h * st.dpr);
    const [w, s, e, n] = FC.bbox;
    proj = d3.geoMercator().fitExtent([[104, 76], [st.w - 36, st.h - 140]], { type: "MultiPoint", coordinates: [[w, s], [e, s], [e, n], [w, n]] });
    TX = new Float32Array(FC.T); TY = new Float32Array(FC.T);
    for (let t = 0; t < FC.T; t++) { const p = proj([FC.lon0[t] + S / 2, FC.lat0[t] + S / 2]); TX[t] = p[0]; TY[t] = p[1]; }
    tilePx = proj([S, 0])[0] - proj([0, 0])[0];
    const gp = d3.geoPath(proj);
    landP = new Path2D(gp({ type: "FeatureCollection", features: land }));
    bordP = new Path2D(gp(borders));
    countryP = new Map();
    labels = land.map(f => ({ name: f.properties.name, area: gp.area(f), c: gp.centroid(f) })).filter(l => isFinite(l.c[0]) && l.area > 30);
    hex = null; vals = null; level = null;
  }

  // ---- hex grid: depends on zoom level only, so panning and month changes never re-bin ----
  const hexKey = (q, r) => (q + 20000) * 40000 + (r + 20000);
  function axial(x, y, R) { // pointy-top hexes, cube rounding
    const qf = (SQ3 / 3 * x - y / 3) / R, rf = 2 / 3 * y / R;
    let q = Math.round(qf), r = Math.round(rf), s = Math.round(-qf - rf);
    const dq = Math.abs(q - qf), dr = Math.abs(r - rf), ds = Math.abs(s + qf + rf);
    if (dq > dr && dq > ds) q = -r - s; else if (dr > ds) r = -q - s;
    return [q, r];
  }
  function ensureHex() {
    const want = Math.max(5 / st.tr.k, 0.8 * tilePx), L = Math.round(Math.log2(want) * 4); // quarter-octave steps
    if (hex && L === level) return;
    level = L;
    const rb = Math.pow(2, L / 4), id = new Int32Array(FC.T), map = new Map(), qs = [], rs = [];
    for (let t = 0; t < FC.T; t++) {
      const [q, r] = axial(TX[t], TY[t], rb), key = hexKey(q, r);
      let i = map.get(key);
      if (i === undefined) { i = qs.length; map.set(key, i); qs.push(q); rs.push(r); }
      id[t] = i;
    }
    const H = qs.length, cx = new Float32Array(H), cy = new Float32Array(H), area = new Float64Array(H), cnt = new Int32Array(H);
    for (let i = 0; i < H; i++) { cx[i] = rb * SQ3 * (qs[i] + rs[i] / 2); cy[i] = rb * 1.5 * rs[i]; }
    for (let t = 0; t < FC.T; t++) { area[id[t]] += FC.area[t]; cnt[id[t]]++; }
    hex = { rb, id, H, cx, cy, area, cnt, map };
    vals = null;
  }
  function ensureVals() {
    if (vals && vals.month === st.month) return;
    const { id, H } = hex, v = new Float64Array(H), med = new Float64Array(H), mo = st.month, c = cal[mo], T = FC.T, Mo = FC.Mo;
    const f = mo === FC.partialIdx ? FC.partial.fraction : 1; // a running month is compared with a pro-rated normal
    for (let t = 0; t < T; t++) { const i = id[t]; v[i] += FC.mat[t * Mo + mo]; med[i] += FC.tileMean[t * 12 + c] * f; }
    vals = { month: mo, v, med };
  }
  function hexValue(i) { // number for the active metric, or null to skip
    const v = vals.v[i];
    if (st.metric === "count") return v >= 0.3 ? v : null; // below this a hexagon is effectively empty
    if (st.metric === "density") return v >= 0.3 ? v / hex.area[i] * 1000 : null;
    const med = vals.med[i];
    if (v < 0.3 && med < 1) return null; // nothing happened and little was expected: stay quiet
    return (v - med) / Math.max(med, 1);
  }
  FC.capFor = metric => {
    FC.metricCap = FC.metricCap || {};
    if (FC.metricCap[metric]) return FC.metricCap[metric];
    const sample = [];
    for (let i = 0; i < FC.mat.length; i += 11) { const v = FC.mat[i]; if (v >= 0.3) sample.push(metric === "density" ? v / FC.area[Math.floor(i / FC.Mo)] * 1000 : v); }
    const a = Float32Array.from(sample).sort();
    return (FC.metricCap[metric] = a[Math.floor(a.length * 0.985)] || 1);
  };

  const NB = 28, bucket = Array.from({ length: NB }, () => []);
  function render() {
    raf = 0;
    const { dpr, tr } = st, k = tr.k;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = col.sea; ctx.fillRect(0, 0, st.w, st.h);
    ctx.setTransform(dpr * k, 0, 0, dpr * k, dpr * tr.x, dpr * tr.y);
    ctx.fillStyle = col.land; ctx.fill(landP);
    ctx.strokeStyle = col.border; ctx.lineWidth = 0.8 / k; ctx.stroke(bordP);

    ensureHex(); ensureVals();
    const { rb, H, cx, cy } = hex, [x0, y0] = tr.invert([-rb * k, -rb * k]), [x1, y1] = tr.invert([st.w + rb * k, st.h + rb * k]);
    bucket.forEach(b => { b.length = 0; });
    const anom = st.metric === "anomaly", cap = anom ? 1 : FC.capFor(st.metric);
    for (let i = 0; i < H; i++) {
      const x = cx[i], y = cy[i];
      if (x < x0 || x > x1 || y < y0 || y > y1) continue;
      const v = hexValue(i);
      if (v === null) continue;
      const t = anom ? (Math.max(-1, Math.min(1, v)) + 1) / 2 : Math.min(1, v / cap);
      bucket[Math.min(NB - 1, (t * (NB - 0.001)) | 0)].push(i);
    }
    const R = rb * 0.93, ox = new Float32Array(6), oy = new Float32Array(6);
    for (let a = 0; a < 6; a++) { const ang = Math.PI / 180 * (60 * a - 30); ox[a] = R * Math.cos(ang); oy[a] = R * Math.sin(ang); }
    for (let b = 0; b < NB; b++) {
      const hs = bucket[b];
      if (!hs.length) continue;
      const t = (b + 0.5) / NB;
      ctx.fillStyle = anom ? FC.diverge(t * 2 - 1) : FC.heat(t);
      ctx.beginPath();
      for (let j = 0; j < hs.length; j++) {
        const i = hs[j], X = cx[i], Y = cy[i];
        ctx.moveTo(X + ox[0], Y + oy[0]);
        for (let a = 1; a < 6; a++) ctx.lineTo(X + ox[a], Y + oy[a]);
        ctx.closePath();
      }
      ctx.fill();
    }

    // outside the loaded regions: scrim; outside the selection: dim
    const scrim = col.scrim;
    ctx.beginPath(); ctx.rect(-1e6, -1e6, 2e6, 2e6);
    for (const r of FC.loadedRegions) { const a = proj([r.bbox[0], r.bbox[3]]), b = proj([r.bbox[2], r.bbox[1]]); ctx.rect(a[0], a[1], b[0] - a[0], b[1] - a[1]); }
    ctx.fillStyle = scrim; ctx.fill("evenodd");
    if (dimPath) { ctx.fillStyle = scrim; ctx.fill(dimPath, "evenodd"); }

    // labels in screen space so the type stays crisp
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    const muted = col.muted;
    const lab = (txt, bx, by, size, weight) => {
      const x = bx * k + tr.x, y = by * k + tr.y;
      if (x < -80 || y < -20 || x > st.w + 80 || y > st.h + 20) return;
      ctx.font = `${weight} ${size}px IBM Plex Sans, system-ui, sans-serif`; ctx.fillStyle = muted; ctx.fillText(txt, x, y);
    };
    for (const l of labels) if (l.area * k * k >= 4200) lab(l.name, l.c[0], l.c[1], 11, 500);
    if (k < 3) for (const r of FC.regions) {
      if (r.loaded) continue;
      const c = proj([(r.bbox[0] + r.bbox[2]) / 2, (r.bbox[1] + r.bbox[3]) / 2]);
      lab(r.name.replace(/_/g, " ").toUpperCase(), c[0], c[1] - 8, 10.5, 600);
      lab("data not loaded yet", c[0], c[1] + 8, 10.5, 400);
    }
    overlay.attr("transform", tr.toString());
  }
  const schedule = () => { if (!raf) raf = requestAnimationFrame(render); };
  const countryPath = name => {
    let p = countryP.get(name);
    if (!p) countryP.set(name, p = new Path2D(d3.geoPath(proj)(countryOf.get(name))));
    return p;
  };

  function updateLegend() {
    if (st.metric === "anomaly") FC.scaleBar(o.legend, t => FC.diverge(t * 2 - 1), "below the month's average", "above it");
    else FC.scaleBar(o.legend, t => FC.heat(t * t), "0", st.metric === "density" ? `${FC.fmt1(FC.capFor("density"))}+ per 1000 km²` : `${FC.fmt(FC.capFor("count"))}+ fire cell-days`);
  }

  const geo = ev => { const [px, py] = d3.pointer(ev, svg.node()); return proj.invert(st.tr.invert([px, py])); };
  const pathOf = (poly, close = true) => (poly && poly.length ? "M" + poly.map(p => proj(p).join(",")).join("L") + (close ? "Z" : "") : "");
  const rectPoly = (a, b) => [[a[0], a[1]], [b[0], a[1]], [b[0], b[1]], [a[0], b[1]]];
  const selOutline = sel => (!sel || sel.kind === "all" ? "" : sel.kind === "country" ? d3.geoPath(proj)(countryOf.get(sel.name)) : pathOf(sel.poly));

  function buildDim() { // everything outside the selection, built once per selection instead of per frame
    const sel = st.sel;
    if (!sel || sel.kind === "all") { dimPath = null; return; }
    const p = new Path2D(); p.rect(-1e6, -1e6, 2e6, 2e6);
    if (sel.kind === "country") p.addPath(countryPath(sel.name));
    else { const q = new Path2D(); sel.poly.forEach((pt, i) => { const c = proj(pt); i ? q.lineTo(c[0], c[1]) : q.moveTo(c[0], c[1]); }); q.closePath(); p.addPath(q); }
    dimPath = p;
  }
  function select(sel) {
    st.sel = sel;
    buildDim();
    selPath.attr("d", selOutline(sel));
    schedule();
    o.onSelect(sel);
  }
  function selectPoly(kind, poly) { select({ kind, poly, tiles: FC.tilesInPolygon(poly), km2: FC.polyKm2(poly), name: null }); }
  function selectCountry(name) {
    const info = FC.countryByName.get(name);
    if (!info || !countryOf.has(name)) return;
    select({ kind: "country", name, tiles: Uint32Array.from(info.tiles), km2: info.km2, poly: null });
    api.fit(info.tiles);
  }
  function selectAll() { select({ kind: "all", name: null, poly: null, tiles: FC.allTiles, km2: FC.loadedKm2 }); }

  svg.on("pointerdown", ev => {
    if (ev.button !== 0 || st.tool === "pan") return;
    if (st.tool === "rect") {
      const a = geo(ev); draft = { a, b: a };
      try { svg.node().setPointerCapture(ev.pointerId); } catch (e) { /* synthetic event */ }
    } else if (st.tool === "poly") {
      const p = geo(ev); draft = draft || { pts: [] };
      const f = draft.pts[0];
      if (f && draft.pts.length >= 3 && Math.hypot(...proj(p).map((v, i) => v - proj(f)[i])) < 9 / st.tr.k) return closePoly();
      draft.pts.push(p); drawDraft();
    }
  });
  svg.on("pointermove", ev => {
    if (draft && draft.a) { draft.b = geo(ev); draftPath.attr("d", pathOf(rectPoly(draft.a, draft.b))); }
    else if (draft && draft.pts) drawDraft(geo(ev));
    else { hoverEv = ev; if (!hoverRaf) hoverRaf = requestAnimationFrame(hover); }
  });
  svg.on("pointerup", () => {
    if (!(draft && draft.a)) return;
    const { a, b } = draft; draft = null; draftPath.attr("d", "");
    if (Math.abs(a[0] - b[0]) > 0.05 && Math.abs(a[1] - b[1]) > 0.05) selectPoly("rect", rectPoly(a, b));
  });
  svg.on("click.country", ev => {
    if (st.tool !== "country") return;
    const pt = geo(ev), f = land.find(f => FC.countryByName.has(f.properties.name) && d3.geoContains(f, pt));
    if (f) { selectCountry(f.properties.name); o.onPick && o.onPick(f.properties.name); }
  });
  svg.on("dblclick.draw", ev => { if (st.tool === "poly" && draft) { ev.preventDefault(); closePoly(); } });
  svg.on("pointerleave", () => { hoverEv = null; FC.tip.hide(); });
  window.addEventListener("keydown", e => { if (e.key === "Escape") cancelDraft(); });
  function cancelDraft() { draft = null; draftPath.attr("d", ""); draftDots.selectAll("*").remove(); }
  function drawDraft(cursor) {
    const pts = draft.pts.concat(cursor ? [cursor] : []);
    draftPath.attr("d", pts.length > 1 ? pathOf(pts, false) : "").attr("fill", "none");
    draftDots.selectAll("circle").data(draft.pts).join("circle").attr("r", 4 / st.tr.k).attr("cx", d => proj(d)[0]).attr("cy", d => proj(d)[1]).attr("fill", "var(--accent)");
  }
  function closePoly() { const pts = draft.pts; cancelDraft(); if (pts.length >= 3) selectPoly("poly", pts); }

  function hover() {
    hoverRaf = 0;
    const ev = hoverEv;
    if (!ev || !hex || !vals) return;
    const [px, py] = d3.pointer(ev, svg.node()), [bx, by] = st.tr.invert([px, py]);
    const [q, r] = axial(bx, by, hex.rb), i = hex.map.get(hexKey(q, r));
    if (i === undefined) { FC.tip.hide(); return; }
    const v = vals.v[i], med = vals.med[i], [lon, lat] = proj.invert([hex.cx[i], hex.cy[i]]);
    const an = med >= 1 ? (v - med) / med : null, n = hex.cnt[i];
    FC.tip.show(ev, `${Math.abs(lat).toFixed(1)}°${lat < 0 ? "S" : "N"}, ${Math.abs(lon).toFixed(1)}°${lon < 0 ? "W" : "E"} · ${n} tile${n > 1 ? "s" : ""}`, [
      { label: "Fire cell-days", value: FC.fmt(v) },
      { label: "Per 1000 km²", value: FC.fmt1(v / hex.area[i] * 1000) },
      { label: "Average " + FC.monthNames[cal[st.month]], value: FC.fmt1(med) },
      ...(an === null ? [] : [{ label: "Versus average", value: (an >= 0 ? "+" : "") + Math.round(an * 100) + "%" }]),
    ]);
  }

  const zoom = d3.zoom().scaleExtent([0.25, 90])
    .filter(ev => ev.type === "wheel" || ev.button === 1 || (st.tool === "pan" && !ev.ctrlKey) || (ev.touches && ev.touches.length > 1))
    .on("zoom", ev => { st.tr = ev.transform; schedule(); });
  svg.call(zoom).on("dblclick.zoom", null);

  const api = {
    state: st,
    setMetric(m) { st.metric = m; updateLegend(); schedule(); },
    setMonth(m) { st.month = m; schedule(); },
    setTool(t) {
      st.tool = t; cancelDraft();
      svg.style("cursor", t === "pan" ? "grab" : t === "country" ? "pointer" : "crosshair");
    },
    selectCountry, selectAll, selectPoly,
    box(w, s, e, n) { selectPoly("rect", rectPoly([w, n], [e, s])); },
    zoomBy(f) { svg.transition().duration(220).call(zoom.scaleBy, f); },
    home() { svg.transition().duration(450).call(zoom.transform, d3.zoomIdentity); },
    fit(tiles) {
      const xs = [], ys = [];
      for (const t of tiles) { xs.push(TX[t]); ys.push(TY[t]); }
      if (!xs.length) return;
      const a0 = d3.min(xs), a1 = d3.max(xs), b0 = d3.min(ys), b1 = d3.max(ys);
      const k = Math.min(40, 0.9 * Math.min((st.w - 150) / Math.max(1, a1 - a0), (st.h - 240) / Math.max(1, b1 - b0)));
      const tx = (st.w + 80) / 2 - k * (a0 + a1) / 2, ty = (st.h - 70) / 2 - k * (b0 + b1) / 2;
      svg.transition().duration(550).call(zoom.transform, d3.zoomIdentity.translate(tx, ty).scale(k));
    },
    render: schedule,
    renderNow: render,
    refreshTheme() { readColors(); updateLegend(); schedule(); },
  };
  new ResizeObserver(() => { layout(); buildDim(); selPath.attr("d", selOutline(st.sel)); schedule(); }).observe(canvas.parentElement);
  readColors();
  layout();
  api.setTool("pan");
  updateLegend();
  selectAll();
  return api;
};
