// Modèle d'estimation FindRebelle.
//
// femmes estimées = population légale (INSEE, réelle)
//                  × part de femmes
//                  × part de la tranche d'âge (selon la taille de la commune)
//                  × taux régional de la couleur de cheveux (hypothèse)
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

export type HairKey = 'red' | 'blond';

export const REGIONS: Record<string, string> = {
  '11': 'Île-de-France',
  '24': 'Centre-Val de Loire',
  '27': 'Bourgogne-Franche-Comté',
  '28': 'Normandie',
  '32': 'Hauts-de-France',
  '44': 'Grand Est',
  '52': 'Pays de la Loire',
  '53': 'Bretagne',
  '75': 'Nouvelle-Aquitaine',
  '76': 'Occitanie',
  '84': 'Auvergne-Rhône-Alpes',
  '93': "Provence-Alpes-Côte d'Azur",
  '94': 'Corse',
};

/**
 * Paramètres par couleur de cheveux (naturelle). Aucune mesure officielle par
 * région n'existe en France : taux national tiré des estimations publiées,
 * multiplicateurs régionaux = hypothèse de gradient nord-ouest / nord-est → sud.
 */
export const HAIRS: Record<
  HairKey,
  { brand: [string, string]; label: string; noun: string; Noun: string; rateLabel: string; national: number; low: number; high: number; k: Record<string, number> }
> = {
  red: {
    brand: ['Find', 'Rebelle'],
    label: 'Rousses',
    noun: 'rousses',
    Noun: 'Rousses',
    rateLabel: 'Taux de rousseur',
    national: 0.03, // estimations publiées : 2 à 5 %
    low: 0.02,
    high: 0.05,
    k: { '53': 1.5, '28': 1.3, '32': 1.2, '52': 1.15, '44': 1.1, '24': 1.0, '27': 1.0, '75': 0.95, '11': 0.9, '84': 0.9, '76': 0.8, '93': 0.75, '94': 0.6 },
  },
  blond: {
    brand: ['Find', 'Golden'],
    label: 'Blondes',
    noun: 'blondes',
    Noun: 'Blondes',
    rateLabel: 'Taux de blondeur',
    national: 0.1, // estimation publiée : environ 10 % ; fourchette 6 à 15 %
    low: 0.06,
    high: 0.15,
    k: { '44': 1.35, '32': 1.3, '28': 1.25, '53': 1.15, '27': 1.1, '52': 1.05, '24': 1.0, '84': 0.95, '11': 0.9, '75': 0.9, '76': 0.75, '93': 0.7, '94': 0.5 },
  },
};

export function hairRate(hair: HairKey, reg: string): number {
  const h = HAIRS[hair];
  return h.national * (h.k[reg] ?? 1);
}

/** Bornes de la fourchette affichée (incertitude sur le taux national). */
export function range(hair: HairKey): [number, number] {
  const h = HAIRS[hair];
  return [h.low / h.national, h.high / h.national];
}

export type Estimate = {
  women: number; // femmes de la tranche
  n: number; // femmes estimées avec cette couleur de cheveux
  rate: number; // taux de rousseur
  density: number; // n / km²
  share: number; // n / population totale de la commune
};

export function estimate(c: Commune, age: AgeKey, hair: HairKey): Estimate {
  const women = c.pop * FEMALE_SHARE * ageShare(c.pop, age);
  const rate = hairRate(hair, c.reg);
  const n = women * rate;
  return { women, n, rate, density: n / c.km2, share: n / c.pop };
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
