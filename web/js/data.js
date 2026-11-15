// Loads the precomputed harmonized matrix and exposes small helpers. Everything is global on FC.
const FC = {};

FC.fmt = d3.format(",.0f");
FC.fmt1 = d3.format(",.1f");
FC.monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

FC.load = async function () {
  const [meta, series, buf] = await Promise.all([
    fetch("data/meta.json").then(r => r.json()),
    fetch("data/series.json").then(r => r.json()),
    fetch("data/matrix.bin").then(r => r.arrayBuffer()),
  ]);
  FC.meta = meta;
  FC.countries = await fetch("data/countries.json").then(r => (r.ok ? r.json() : [])).catch(() => []);
  FC.countries = FC.countries.filter(c => c.tiles.length > 0);
  FC.countryByName = new Map(FC.countries.map(c => [c.name, c]));
  FC.series = series;
  FC.months = meta.months;
  FC.Mo = meta.months.length;
  FC.T = meta.tiles.length;
  FC.mat = Float32Array.from(new Uint16Array(buf), v => v / (meta.scale || 1)); // fixed-point on disk
  FC.year = meta.months.map(m => +m.slice(0, 4));
  FC.cal = meta.months.map(m => +m.slice(5, 7) - 1);
  FC.date = meta.months.map(m => new Date(m + "-01T00:00:00Z"));
  FC.years = d3.range(FC.year[0], FC.year[FC.Mo - 1] + 1);

  const s = meta.tile_size;
  FC.lon0 = new Float32Array(FC.T);
  FC.lat0 = new Float32Array(FC.T);
  FC.area = new Float32Array(FC.T); // km2
  meta.tiles.forEach(([tx, ty], i) => {
    FC.lon0[i] = tx * s;
    FC.lat0[i] = ty * s;
    const latc = (ty + 0.5) * s;
    FC.area[i] = s * 111.32 * Math.cos(latc * Math.PI / 180) * s * 110.57;
  });
  FC.bbox = [d3.min(FC.lon0), d3.min(FC.lat0), d3.max(FC.lon0) + s, d3.max(FC.lat0) + s]; // W S E N
  FC.allTiles = Uint32Array.from({ length: FC.T }, (_, i) => i);
  FC.partial = meta.partial || null; // newest month still running: kept, but never used as a "normal"
  FC.partialIdx = FC.partial ? meta.months.indexOf(FC.partial.month) : -1;
  FC.byCal = d3.range(12).map(c => d3.range(FC.Mo).filter(m => FC.cal[m] === c && m !== FC.partialIdx));
  FC.regions = meta.coverage || [];
  FC.loadedRegions = FC.regions.filter(r => r.loaded);
  FC.loadedKm2 = d3.sum(FC.loadedRegions, r => FC.polyKm2([[r.bbox[0], r.bbox[1]], [r.bbox[2], r.bbox[1]], [r.bbox[2], r.bbox[3]], [r.bbox[0], r.bbox[3]]]));

  // per-tile, per-calendar-month median and mean across years (typed arrays, no per-call allocation)
  FC.tileMed = new Float32Array(FC.T * 12);
  FC.tileMean = new Float32Array(FC.T * 12); // the map's "normal": most tiles burn rarely, so a median would be 0 almost everywhere
  const byCal = FC.byCal.map(a => Int32Array.from(a));
  const scratch = new Float64Array(40);
  for (let t = 0; t < FC.T; t++) {
    const base = t * FC.Mo;
    for (let c = 0; c < 12; c++) {
      const idx = byCal[c], n = idx.length;
      let sum = 0;
      for (let j = 0; j < n; j++) { const v = FC.mat[base + idx[j]]; scratch[j] = v; sum += v; }
      const a = scratch.subarray(0, n).sort();
      FC.tileMed[t * 12 + c] = n % 2 ? a[(n - 1) >> 1] : (a[n / 2 - 1] + a[n / 2]) / 2;
      FC.tileMean[t * 12 + c] = sum / n;
    }
  }
};

FC.areaKm2 = tiles => { let a = 0; for (const t of tiles) a += FC.area[t]; return a; };

// monthly cell-days summed over a set of tiles
FC.areaSeries = function (tiles) {
  const out = new Float64Array(FC.Mo);
  for (const t of tiles) {
    const o = t * FC.Mo;
    for (let m = 0; m < FC.Mo; m++) out[m] += FC.mat[o + m];
  }
  return out;
};

// median of the same calendar month over all other years; for a running month, pro-rated to the days so far
FC.looMedian = function (vals, m) {
  const others = FC.byCal[FC.cal[m]].filter(k => k !== m).map(k => vals[k]);
  const med = d3.median(others);
  return m === FC.partialIdx ? med * FC.partial.fraction : med;
};

FC.anomaly = function (vals, m) {
  const med = FC.looMedian(vals, m);
  return med > 0 ? (vals[m] - med) / med : null;
};

FC.tilesInPolygon = function (poly) { // poly: [[lon, lat], ...]
  const out = [];
  for (let t = 0; t < FC.T; t++) {
    const s = FC.meta.tile_size;
    if (d3.polygonContains(poly, [FC.lon0[t] + s / 2, FC.lat0[t] + s / 2])) out.push(t);
  }
  return Uint32Array.from(out);
};

FC.monthLabel = function (m) {
  const base = `${FC.monthNames[FC.cal[m]]} ${FC.year[m]}`;
  if (m !== FC.partialIdx) return base;
  const d = new Date(FC.partial.through + "T00:00:00Z");
  return `${base} (to ${d.getUTCDate()} ${FC.monthNames[d.getUTCMonth()]})`;
};
FC.isPartial = m => m === FC.partialIdx;
FC.longMonths = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

// trailing 12-month sum; null until a full year exists
FC.roll12 = arr => arr.map((_, i) => (i < 11 ? null : d3.sum(arr.slice(i - 11, i + 1))));

// 1 = the busiest of the same calendar month across all years
FC.rankOfMonth = function (vals, m) {
  if (m === FC.partialIdx) return null; // a month in progress has no rank yet
  const same = FC.byCal[FC.cal[m]];
  return { rank: same.filter(k => vals[k] > vals[m]).length + 1, of: same.length };
};

// Area of a lon/lat polygon in km2 (spherical), independent of which tiles ever burned
FC.polyKm2 = function (poly) {
  const ring = poly.concat([poly[0]]);
  let a = d3.geoArea({ type: "Polygon", coordinates: [ring] });
  if (a > 2 * Math.PI) a = 4 * Math.PI - a; // winding reads as the complement
  return a * 6371 * 6371;
};
FC.bboxPoly = () => [[FC.bbox[0], FC.bbox[1]], [FC.bbox[2], FC.bbox[1]], [FC.bbox[2], FC.bbox[3]], [FC.bbox[0], FC.bbox[3]]];
