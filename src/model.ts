// Modèle d'estimation FindRebelle.
//
// rousses estimées = population légale (INSEE, réelle)
//                  × part de femmes
//                  × part de la tranche d'âge (selon la taille de la commune)
//                  × taux de rousseur régional (hypothèse)
//
// Seule la population est une donnée mesurée. Les trois autres facteurs sont
// des hypothèses documentées dans la page « Méthode » et modifiables ici.

export type Commune = {
  code: string;
  nom: string;
  dep: string;
  reg: string;
  pop: number;
  lat: number;
  lng: number;
  km2: number;
};

export type AgeKey = '18-24' | '25-29' | '30-39' | '40-49' | '50-64' | '65+' | '18+';

export const AGES: { key: AgeKey; label: string }[] = [
  { key: '18-24', label: '18 – 24 ans' },
  { key: '25-29', label: '25 – 29 ans' },
  { key: '30-39', label: '30 – 39 ans' },
  { key: '40-49', label: '40 – 49 ans' },
  { key: '50-64', label: '50 – 64 ans' },
  { key: '65+', label: '65 ans et +' },
  { key: '18+', label: 'Toutes (18 ans et +)' },
];

/** Part des femmes dans la population (France métropolitaine, INSEE ≈ 51,6 %). */
export const FEMALE_SHARE = 0.516;

/**
 * Part de chaque tranche d'âge parmi les femmes, France entière
 * (ordre de grandeur de la pyramide INSEE au 1er janvier 2024, ±1 point).
 */
const NATIONAL_AGE_SHARE: Record<Exclude<AgeKey, '18+'>, number> = {
  '18-24': 0.074,
  '25-29': 0.053,
  '30-39': 0.117,
  '40-49': 0.123,
  '50-64': 0.189,
  '65+': 0.234,
};

/**
 * Correctifs selon la taille de commune : les grandes villes (universités,
 * premiers emplois) concentrent les 18-29 ans, les petites villes sont plus âgées.
 */
const SIZE_FACTORS: { min: number; f: Record<Exclude<AgeKey, '18+'>, number> }[] = [
  { min: 100_000, f: { '18-24': 1.9, '25-29': 1.6, '30-39': 1.15, '40-49': 0.9, '50-64': 0.8, '65+': 0.75 } },
  { min: 20_000, f: { '18-24': 1.15, '25-29': 1.1, '30-39': 1.0, '40-49': 0.97, '50-64': 0.97, '65+': 0.98 } },
  { min: 0, f: { '18-24': 0.8, '25-29': 0.85, '30-39': 0.95, '40-49': 1.02, '50-64': 1.05, '65+': 1.08 } },
];

export function ageShare(pop: number, age: AgeKey): number {
  const { f } = SIZE_FACTORS.find((s) => pop >= s.min)!;
  if (age === '18+') {
    return (Object.keys(NATIONAL_AGE_SHARE) as Exclude<AgeKey, '18+'>[]).reduce(
      (sum, k) => sum + NATIONAL_AGE_SHARE[k] * f[k],
      0,
    );
  }
  return NATIONAL_AGE_SHARE[age] * f[age];
}

/** Taux national de rousseur naturelle retenu (estimations publiées : 2 à 5 %). */
export const NATIONAL_RED_RATE = 0.03;

/**
 * Multiplicateurs régionaux (codes région INSEE 2016). Hypothèse : gradient
 * nord-ouest → sud-est, cohérent avec la répartition européenne des variants
 * MC1R. Aucune mesure par région n'existe en France.
 */
export const REGIONS: Record<string, { nom: string; k: number }> = {
  '53': { nom: 'Bretagne', k: 1.5 },
  '28': { nom: 'Normandie', k: 1.3 },
  '32': { nom: 'Hauts-de-France', k: 1.2 },
  '52': { nom: 'Pays de la Loire', k: 1.15 },
  '44': { nom: 'Grand Est', k: 1.1 },
  '24': { nom: 'Centre-Val de Loire', k: 1.0 },
  '27': { nom: 'Bourgogne-Franche-Comté', k: 1.0 },
  '75': { nom: 'Nouvelle-Aquitaine', k: 0.95 },
  '11': { nom: 'Île-de-France', k: 0.9 },
  '84': { nom: 'Auvergne-Rhône-Alpes', k: 0.9 },
  '76': { nom: 'Occitanie', k: 0.8 },
  '93': { nom: "Provence-Alpes-Côte d'Azur", k: 0.75 },
  '94': { nom: 'Corse', k: 0.6 },
};

export function redRate(reg: string): number {
  return NATIONAL_RED_RATE * (REGIONS[reg]?.k ?? 1);
}

/** Bornes de la fourchette affichée (incertitude sur le taux : 2 % à 5 % national). */
export const RANGE_LOW = 2 / 3;
export const RANGE_HIGH = 5 / 3;

export type Estimate = {
  women: number; // femmes de la tranche
  redheads: number; // rousses estimées
  rate: number; // taux de rousseur
  density: number; // rousses / km²
  share: number; // rousses / population totale de la commune
};

export function estimate(c: Commune, age: AgeKey): Estimate {
  const women = c.pop * FEMALE_SHARE * ageShare(c.pop, age);
  const rate = redRate(c.reg);
  const redheads = women * rate;
  return { women, redheads, rate, density: redheads / c.km2, share: redheads / c.pop };
}

export function parseCommunes(rows: [string, string, string, string, number, number, number, number][]): Commune[] {
  return rows.map(([code, nom, dep, reg, pop, lat, lng, km2]) => ({ code, nom, dep, reg, pop, lat, lng, km2 }));
}

export type TierKey = 'all' | 'xl' | 'l' | 'm' | 's';

/** Catégories de taille (population légale). Le seuil de 2 000 hab. est celui de l'INSEE entre rural et urbain. */
export const TIERS: { key: TierKey; label: string; range: string; min: number; max: number }[] = [
  { key: 'all', label: 'Toutes', range: '2 000 hab. et +', min: 0, max: Infinity },
  { key: 'xl', label: 'Grandes villes', range: '100 000 hab. et +', min: 100_000, max: Infinity },
  { key: 'l', label: 'Villes moyennes', range: '20 000 – 99 999 hab.', min: 20_000, max: 100_000 },
  { key: 'm', label: 'Petites villes', range: '5 000 – 19 999 hab.', min: 5_000, max: 20_000 },
  { key: 's', label: 'Bourgs et villages', range: '2 000 – 4 999 hab.', min: 0, max: 5_000 },
];

export function tierOf(pop: number) {
  return TIERS.find((t) => t.key !== 'all' && pop >= t.min && pop < t.max)!;
}

export function inTier(c: Commune, tier: TierKey) {
  const t = TIERS.find((x) => x.key === tier)!;
  return c.pop >= t.min && c.pop < t.max;
}
