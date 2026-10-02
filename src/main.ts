import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import './style.css';
import { AGES, estimate, inTier, parseCommunes, RANGE_HIGH, RANGE_LOW, REGIONS, TIERS, tierOf, type AgeKey, type Commune, type Estimate, type TierKey } from './model';

type Metric = 'count' | 'share' | 'density';

const state: { age: AgeKey; metric: Metric; tier: TierKey } = { age: '25-29', metric: 'count', tier: 'all' };
let tableSort: Metric | 'pop' = 'count';
let tableLimit = 100;

const COMMUNE_MIN_ZOOM = 8;
const PALETTE = ['#fbe3cf', '#f6bf94', '#ee9a5f', '#de7438', '#bf531e', '#8c3510'];

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const fmt = new Intl.NumberFormat('fr-FR');
const fmt1 = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 });
const fmt2 = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 });
const pct = new Intl.NumberFormat('fr-FR', { style: 'percent', maximumFractionDigits: 1 });

function round(n: number): string {
  if (n >= 100) return fmt.format(Math.round(n / 10) * 10);
  if (n >= 10) return fmt.format(Math.round(n));
  if (n >= 1) return fmt1.format(n);
  return fmt2.format(n);
}

const pctFine = new Intl.NumberFormat('fr-FR', { style: 'percent', minimumFractionDigits: 2, maximumFractionDigits: 3 });

const METRICS: Record<Metric, { rank: string; unit: string; title: string; format: (v: number) => string }> = {
  count: { rank: 'nombre', unit: 'rousses', title: 'Où il y en a le plus', format: (v) => `≈ ${round(v)}` },
  share: { rank: '% habitants', unit: '% de la population', title: 'Où la proportion est la plus forte', format: (v) => pctFine.format(v) },
  density: { rank: 'densité', unit: 'rousses / km²', title: 'Où la densité est la plus forte', format: (v) => `${round(v)}/km²` },
};

function value(e: Estimate, metric: Metric) {
  return metric === 'count' ? e.redheads : metric === 'share' ? e.share : e.density;
}

function readHash() {
  const p = new URLSearchParams(location.hash.slice(1));
  const age = p.get('age') as AgeKey | null;
  const metric = p.get('m') as Metric | null;
  if (age && AGES.some((a) => a.key === age)) state.age = age;
  if (metric && metric in METRICS) state.metric = metric;
  return p.has('age');
}

function writeHash() {
  history.replaceState(null, '', `#age=${encodeURIComponent(state.age)}&m=${state.metric}`);
}

// Seuils par quantiles pour que la palette reste lisible quelle que soit la tranche.
function breaks(values: number[]): number[] {
  const s = [...values].sort((a, b) => a - b);
  return [0.5, 0.75, 0.88, 0.95, 0.985].map((q) => s[Math.floor(q * (s.length - 1))]);
}

function colorFor(v: number, b: number[]) {
  let i = 0;
  while (i < b.length && v > b[i]) i++;
  return PALETTE[i];
}

async function main() {
  const [rows, depsGeo] = await Promise.all([
    fetch('data/communes.json').then((r) => r.json()),
    fetch('data/departements.geojson').then((r) => r.json()),
  ]);
  const communes: Commune[] = parseCommunes(rows);
  const byName = new Map<string, Commune>();
  for (const c of communes) {
    const key = byName.has(c.nom) ? `${c.nom} (${c.dep})` : c.nom;
    byName.set(key, c);
  }

  const hadHash = readHash();

  // ---- Carte -------------------------------------------------------------
  const map = L.map('map', { zoomControl: false, minZoom: 5, maxZoom: 15, preferCanvas: true }).setView([46.6, 2.4], 6);
  L.control.zoom({ position: 'topleft' }).addTo(map);
  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; OpenStreetMap &copy; CARTO · Population INSEE · Contours IGN',
    subdomains: 'abcd',
    maxZoom: 19,
  }).addTo(map);

  const renderer = L.canvas({ padding: 0.5 });
  const depLayer = L.geoJSON(depsGeo, { style: { weight: 1, color: '#2a1d17', fillOpacity: 0.7 } }).addTo(map);
  const communeLayer = L.layerGroup();
  const markers = new Map<string, L.CircleMarker>();
  for (const c of communes) {
    const m = L.circleMarker([c.lat, c.lng], { renderer, weight: 1, color: '#16100d', fillOpacity: 0.9 });
    m.on('click', () => openCommune(c));
    markers.set(c.code, m);
    communeLayer.addLayer(m);
  }

  let estimates = new Map<string, Estimate>();
  let ranking: Commune[] = [];
  let communeBreaks: number[] = [];
  let depBreaks: number[] = [];

  function openCommune(c: Commune, fly = false) {
    const e = estimates.get(c.code)!;
    const rank = ranking.indexOf(c) + 1;
    const tier = tierOf(c.pop);
    const tierRank = ranking.filter((x) => inTier(x, tier.key)).indexOf(c) + 1;
    const tierCount = communes.filter((x) => inTier(x, tier.key)).length;
    const ageLabel = AGES.find((a) => a.key === state.age)!.label;
    const html = `
      <div class="pop">
        <p class="kicker">${c.dep} · ${REGIONS[c.reg]?.nom ?? ''}</p>
        <h3>${c.nom}</h3>
        <p class="big">≈ ${round(e.redheads)} <span>rousses</span></p>
        <p class="range">fourchette ${round(e.redheads * RANGE_LOW)} – ${round(e.redheads * RANGE_HIGH)}</p>
        <dl>
          <dt>Femmes ${ageLabel.toLowerCase()}</dt><dd>≈ ${round(e.women)}</dd>
          <dt>Taux de rousseur (hyp.)</dt><dd>${pct.format(e.rate)}</dd>
          <dt>Part des habitants</dt><dd>${pctFine.format(e.share)}</dd>
          <dt>Densité</dt><dd>${round(e.density)} / km²</dd>
          <dt>Population totale</dt><dd>${fmt.format(c.pop)}</dd>
          <dt>Rang national (${METRICS[state.metric].rank})</dt><dd>${fmt.format(rank)} / ${fmt.format(communes.length)}</dd>
          <dt>Rang ${tier.label.toLowerCase()}</dt><dd>${fmt.format(tierRank)} / ${fmt.format(tierCount)}</dd>
        </dl>
      </div>`;
    if (fly) map.flyTo([c.lat, c.lng], Math.max(map.getZoom(), 11), { duration: 0.8 });
    L.popup({ maxWidth: 280 }).setLatLng([c.lat, c.lng]).setContent(html).openOn(map);
  }

  function updateZoom() {
    const z = map.getZoom();
    if (z >= COMMUNE_MIN_ZOOM - 1) communeLayer.addTo(map);
    else communeLayer.remove();
    depLayer.setStyle({ fillOpacity: z >= COMMUNE_MIN_ZOOM - 1 ? 0.18 : 0.75 });
  }

  function drawLegend() {
    const communesShown = map.getZoom() >= COMMUNE_MIN_ZOOM - 1;
    const b = communesShown ? communeBreaks : depBreaks;
    const { unit, format } = METRICS[state.metric];
    const f = (v: number) => format(v).replace(/^≈ /, '').replace('/km²', '');
    $('legend').innerHTML =
      `<p>${communesShown ? 'Communes' : 'Départements'} · ${unit}</p><div class="scale">` +
      PALETTE.map((col, i) => {
        const label = i === 0 ? `≤ ${f(b[0])}` : i === PALETTE.length - 1 ? `> ${f(b[i - 1])}` : `${f(b[i - 1])} – ${f(b[i])}`;
        return `<span><i style="background:${col}"></i>${label}</span>`;
      }).join('') +
      '</div>';
  }

  function render() {
    estimates = new Map(communes.map((c) => [c.code, estimate(c, state.age)]));
    const v = (c: Commune) => value(estimates.get(c.code)!, state.metric);
    ranking = [...communes].sort((a, b) => v(b) - v(a));

    // Communes
    const cb = (communeBreaks = breaks(communes.map(v)));
    const maxCount = Math.max(...communes.map((c) => estimates.get(c.code)!.redheads));
    for (const c of communes) {
      const e = estimates.get(c.code)!;
      markers.get(c.code)!.setStyle({ fillColor: colorFor(v(c), cb) }).setRadius(3 + 22 * Math.sqrt(e.redheads / maxCount));
    }

    // Départements (agrégat des communes ≥ 2 000 hab.)
    const agg = new Map<string, { n: number; km2: number; pop: number }>();
    for (const c of communes) {
      const a = agg.get(c.dep) ?? { n: 0, km2: 0, pop: 0 };
      a.n += estimates.get(c.code)!.redheads;
      a.km2 += c.km2;
      a.pop += c.pop;
      agg.set(c.dep, a);
    }
    const depVal = (code: string) => {
      const a = agg.get(code);
      if (!a) return 0;
      return state.metric === 'count' ? a.n : state.metric === 'share' ? a.n / a.pop : a.n / a.km2;
    };
    const db = (depBreaks = breaks([...agg.keys()].map(depVal)));
    depLayer.eachLayer((layer) => {
      const f = (layer as L.GeoJSON).feature as GeoJSON.Feature<GeoJSON.Geometry, { code: string; nom: string }>;
      const a = agg.get(f.properties.code);
      (layer as L.Path).setStyle({ fillColor: colorFor(depVal(f.properties.code), db) });
      layer.unbindTooltip();
      layer.bindTooltip(
        `<strong>${f.properties.nom}</strong><br>≈ ${round(a?.n ?? 0)} rousses · ${pctFine.format(a ? a.n / a.pop : 0)} des habitants · ${round(a ? a.n / a.km2 : 0)} / km²`,
        { sticky: true },
      );
    });
    updateZoom();

    // Panneau
    const ageLabel = AGES.find((a) => a.key === state.age)!.label;
    $('panel-kicker').textContent = `Rousses · ${ageLabel}`;
    $('panel-title').textContent = METRICS[state.metric].title;
    const top = $('top');
    top.innerHTML = '';
    $('tiers').querySelectorAll<HTMLButtonElement>('button').forEach((b) => b.classList.toggle('on', b.dataset.tier === state.tier));
    for (const c of ranking.filter((x) => inTier(x, state.tier)).slice(0, 15)) {
      const e = estimates.get(c.code)!;
      const li = document.createElement('li');
      li.innerHTML = `<button type="button"><span>${c.nom} <small>${c.dep}</small></span><b>${METRICS[state.metric].format(
        value(e, state.metric),
      )}</b></button>`;
      li.querySelector('button')!.addEventListener('click', () => openCommune(c, true));
      top.appendChild(li);
    }
    drawLegend();

    document.querySelectorAll<HTMLButtonElement>('.toggle button').forEach((b) => b.classList.toggle('on', b.dataset.metric === state.metric));
    ($('age') as HTMLSelectElement).value = state.age;
    map.closePopup();
    writeHash();
    if (($('ranking') as HTMLDialogElement).open) drawTable();
  }

  // ---- Classement complet -----------------------------------------------
  function drawTable() {
    const tier = TIERS.find((t) => t.key === state.tier)!;
    const key = (c: Commune) => (tableSort === 'pop' ? c.pop : value(estimates.get(c.code)!, tableSort));
    const rows = communes.filter((c) => inTier(c, state.tier)).sort((a, b) => key(b) - key(a));
    const ageLabel = AGES.find((a) => a.key === state.age)!.label;
    $('ranking-sub').textContent = `${tier.label} · ${tier.range} · ${fmt.format(rows.length)} communes · rousses ${ageLabel.toLowerCase()}`;
    $('ranking-tiers').querySelectorAll<HTMLButtonElement>('button').forEach((b) => b.classList.toggle('on', b.dataset.tier === state.tier));
    document.querySelectorAll<HTMLButtonElement>('#ranking th button').forEach((b) => {
      const on = b.dataset.sort === tableSort;
      b.classList.toggle('on', on);
      b.closest('th')!.setAttribute('aria-sort', on ? 'descending' : 'none');
    });
    const body = $('ranking-body');
    body.innerHTML = rows
      .slice(0, tableLimit)
      .map((c, i) => {
        const e = estimates.get(c.code)!;
        return `<tr data-code="${c.code}" tabindex="0"><td>${i + 1}</td><td><span class="nom">${c.nom}</span> <small>${c.dep}</small></td><td>${fmt.format(
          c.pop,
        )}</td><td>≈ ${round(e.redheads)}</td><td>${pctFine.format(e.share)}</td><td>${round(e.density)}</td></tr>`;
      })
      .join('');
    $('ranking-more').hidden = rows.length <= tableLimit;
    $('ranking-more').textContent = `Afficher 100 de plus (${fmt.format(rows.length - tableLimit)} restantes)`;
  }

  const ranking_ = $<HTMLDialogElement>('ranking');
  const byCode = new Map(communes.map((c) => [c.code, c]));
  const pick = (target: EventTarget | null) => {
    const tr = (target as HTMLElement).closest('tr[data-code]');
    if (!tr) return;
    ranking_.close();
    openCommune(byCode.get(tr.getAttribute('data-code')!)!, true);
  };
  $('ranking-body').addEventListener('click', (ev) => pick(ev.target));
  $('ranking-body').addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') pick(ev.target);
  });
  $('ranking-more').addEventListener('click', () => {
    tableLimit += 100;
    drawTable();
  });
  document.querySelectorAll<HTMLButtonElement>('#ranking th button').forEach((b) =>
    b.addEventListener('click', () => {
      const s = b.dataset.sort as Metric | 'pop';
      tableSort = s;
      tableLimit = 100;
      if (s !== 'pop' && s !== state.metric) {
        state.metric = s;
        render();
      } else drawTable();
    }),
  );
  $('open-ranking').addEventListener('click', () => {
    tableSort = state.metric;
    tableLimit = 100;
    drawTable();
    ranking_.showModal();
  });

  for (const host of [$('tiers'), $('ranking-tiers')]) {
    for (const t of TIERS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip small';
      b.dataset.tier = t.key;
      b.title = t.range;
      b.textContent = t.label;
      b.addEventListener('click', () => {
        state.tier = t.key;
        tableLimit = 100;
        render();
      });
      host.appendChild(b);
    }
  }

  map.on('zoomend', () => {
    updateZoom();
    drawLegend();
  });

  // ---- Contrôles ---------------------------------------------------------
  const ageSelect = $<HTMLSelectElement>('age');
  for (const a of AGES) ageSelect.add(new Option(a.label, a.key));
  ageSelect.addEventListener('change', () => {
    state.age = ageSelect.value as AgeKey;
    render();
  });

  document.querySelectorAll<HTMLButtonElement>('.toggle button').forEach((b) =>
    b.addEventListener('click', () => {
      state.metric = b.dataset.metric as Metric;
      render();
    }),
  );

  const list = $('communes-list');
  list.innerHTML = [...byName.keys()].map((n) => `<option value="${n.replace(/"/g, '&quot;')}"></option>`).join('');
  const search = $<HTMLInputElement>('search');
  search.addEventListener('change', () => {
    const c = byName.get(search.value) ?? communes.find((x) => x.nom.toLowerCase() === search.value.trim().toLowerCase());
    if (!c) return;
    map.once('moveend', () => openCommune(c));
    map.flyTo([c.lat, c.lng], 12, { duration: 0.8 });
    search.blur();
  });

  const panelToggle = $('panel-toggle');
  if (matchMedia('(max-width: 720px)').matches) {
    $('panel').classList.add('collapsed');
    panelToggle.setAttribute('aria-expanded', 'false');
  }
  panelToggle.addEventListener('click', () => {
    const collapsed = $('panel').classList.toggle('collapsed');
    panelToggle.setAttribute('aria-expanded', String(!collapsed));
  });

  const method = $<HTMLDialogElement>('method');
  $('open-method').addEventListener('click', () => method.showModal());

  // ---- Accueil -----------------------------------------------------------
  const welcome = $<HTMLDialogElement>('welcome');
  const chips = $('welcome-ages');
  for (const a of AGES) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `chip${a.key === state.age ? ' on' : ''}`;
    b.textContent = a.label;
    b.addEventListener('click', () => {
      state.age = a.key;
      chips.querySelectorAll('.chip').forEach((x) => x.classList.toggle('on', x === b));
    });
    chips.appendChild(b);
  }
  welcome.addEventListener('close', render);

  render();
  if (!hadHash) welcome.showModal();
}

main().catch((err) => {
  console.error(err);
  document.body.insertAdjacentHTML('beforeend', '<p class="error">Impossible de charger les données. Recharge la page.</p>');
});
