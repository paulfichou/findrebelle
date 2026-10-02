# FindRebelle

Carte interactive des **estimations** de femmes rousses par commune (≥ 2 000 habitants,
France métropolitaine) et par tranche d'âge.

## Stack

Vite + TypeScript + Leaflet, site 100 % statique (aucun serveur), déployable sur Vercel.

```bash
npm install
npm run dev     # http://localhost:5173
npm run build   # → dist/
npm run data    # régénère public/data/* depuis les sources
```

## Déploiement Vercel

Importer le dépôt dans Vercel (Add New → Project) puis Deploy.
Le framework (Vite) est détecté ; `vercel.json` fixe build et sortie.

## Données et modèle

`rousses = population × 51,6 % femmes × part de la tranche d'âge × taux de rousseur régional`

| Facteur | Statut | Source |
| --- | --- | --- |
| Population par commune | **réelle** | INSEE via `@etalab/decoupage-administratif` |
| Superficie, centroïde | réels | contours IGN via `gregoiredavid/france-geojson` |
| Part de femmes | moyenne nationale | INSEE |
| Part de la tranche d'âge | **modélisée** (pyramide nationale × correctif taille de ville) | INSEE 2024 |
| Taux de rousseur | **hypothèse** (3 % national, ×0,6 à ×1,5 par région) | aucune mesure officielle |

Tous les paramètres modifiables sont dans `src/model.ts`.

### Amélioration prévue

Remplacer la structure d'âge modélisée par la vraie table INSEE **POP1B** (population
par sexe et âge, par commune) dans `scripts/build-data.mjs`.
