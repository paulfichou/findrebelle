// Génère public/data/communes.json et public/data/departements.geojson.
//
// Sources :
//  - Populations légales : @etalab/decoupage-administratif (INSEE, recensement)
//  - Contours communaux / départementaux : github.com/gregoiredavid/france-geojson
//    (dérivés d'IGN ADMIN EXPRESS ; contours complets pour les communes,
//    simplifiés pour les départements)
//
// Usage : npm run data
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const communes = require('@etalab/decoupage-administratif/data/communes.json');

const MIN_POP = 2000;
const GEO = 'https://raw.githubusercontent.com/gregoiredavid/france-geojson/master';

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  return res.json();
}

const R = 6371.0088; // rayon terrestre moyen (km)
const rad = (d) => (d * Math.PI) / 180;

// Aire sphérique d'un anneau (km²) — formule de Chamberlain & Duquette.
function ringArea(ring) {
  let sum = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[i + 1];
    sum += rad(x2 - x1) * (2 + Math.sin(rad(y1)) + Math.sin(rad(y2)));
  }
  return Math.abs((sum * R * R) / 2);
}

// Centroïde planaire d'un anneau (suffisant à l'échelle d'une commune).
function ringCentroid(ring) {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[i + 1];
    const f = x1 * y2 - x2 * y1;
    a += f; cx += (x1 + x2) * f; cy += (y1 + y2) * f;
  }
  if (a === 0) return ring[0];
  return [cx / (3 * a), cy / (3 * a)];
}

function polygons(geometry) {
  return geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
}

function geoStats(geometry) {
  let area = 0, best = null, bestArea = -1;
  for (const poly of polygons(geometry)) {
    const outer = ringArea(poly[0]);
    const holes = poly.slice(1).reduce((s, r) => s + ringArea(r), 0);
    area += outer - holes;
    if (outer > bestArea) { bestArea = outer; best = poly[0]; }
  }
  return { area, centroid: ringCentroid(best) };
}

const round = (n, d) => Math.round(n * 10 ** d) / 10 ** d;

const [communesGeo, depsGeo] = await Promise.all([
  fetchJson(`${GEO}/communes.geojson`),
  fetchJson(`${GEO}/departements-version-simplifiee.geojson`),
]);

const geoByCode = new Map(communesGeo.features.map((f) => [f.properties.code, f.geometry]));

const rows = [];
const missing = [];
for (const c of communes) {
  if (c.type !== 'commune-actuelle' || c.zone !== 'metro' || (c.population ?? 0) < MIN_POP) continue;
  const geometry = geoByCode.get(c.code);
  if (!geometry) { missing.push(`${c.code} ${c.nom}`); continue; }
  const { area, centroid } = geoStats(geometry);
  // [code, nom, département, région, population, lat, lng, superficie km²]
  rows.push([c.code, c.nom, c.departement, c.region, c.population, round(centroid[1], 4), round(centroid[0], 4), round(area, 2)]);
}
rows.sort((a, b) => b[4] - a[4]);

await writeFile('public/data/communes.json', JSON.stringify(rows));

const deps = {
  type: 'FeatureCollection',
  features: depsGeo.features.map((f) => ({
    type: 'Feature',
    properties: { code: f.properties.code, nom: f.properties.nom },
    geometry: {
      type: f.geometry.type,
      coordinates: JSON.parse(JSON.stringify(f.geometry.coordinates, (_, v) => (typeof v === 'number' ? round(v, 3) : v))),
    },
  })),
};
await writeFile('public/data/departements.geojson', JSON.stringify(deps));

const pkg = JSON.parse(await readFile(new URL('../node_modules/@etalab/decoupage-administratif/package.json', import.meta.url)));
console.log(`${rows.length} communes ≥ ${MIN_POP} hab. (decoupage-administratif ${pkg.version})`);
if (missing.length) console.log(`Sans contour (ignorées) : ${missing.join(', ')}`);
