# AgriSat — Détection IA des cultures

AgriSat permet de tracer des parcelles agricoles sur une carte satellite, d’analyser leurs données et de suivre les résultats dans un tableau de bord. L’application s’appuie sur les données Sentinel-1 / Sentinel-2 de Google Earth Engine et sur un modèle de classification pour déterminer si une parcelle contient de l’orge.

## Sommaire

- [Architecture](#architecture)
- [Prérequis](#prérequis)
- [Installation et démarrage local](#installation-et-démarrage-local)
- [Configuration des variables d’environnement](#configuration-des-variables-denvironnement)
- [Structure du projet](#structure-du-projet)
- [API backend](#api-backend)
- [Flux d’analyse d’une parcelle](#flux-danalyse-dune-parcelle)
- [Scripts disponibles](#scripts-disponibles)
- [Développement et vérifications](#développement-et-vérifications)

## Architecture

```text
Navigateur
   │
   ├── Frontend React + Vite (port 8080)
   │     ├── Carte Google Maps et dessin de polygones
   │     ├── Analyse et affichage des résultats
   │     └── Tableau de bord des parcelles
   │
   └── API Fastify (port 3001)
         ├── Validation des requêtes avec Zod
         ├── Analyse satellite et classification
         └── Persistance avec Prisma
                  │
                  └── Base PostgreSQL

Services externes utilisés par le backend :
- Google Earth Engine : données Sentinel-1 et Sentinel-2
- Google Maps : fond cartographique et image de parcelle
- Modèle Hugging Face : classification orge / non-orge
```

## Prérequis

- Node.js 20 ou version ultérieure
- npm 10 ou version ultérieure
- Une base PostgreSQL accessible depuis le backend
- Une clé API Google Maps avec les API Maps JavaScript et Geometry activées
- Un compte de service Google autorisé à utiliser Google Earth Engine
- Un endpoint de modèle de classification compatible avec l’application

## Installation et démarrage local

Installez les dépendances du frontend et du backend :

```bash
npm install
npm --prefix backend install
```

Créez les fichiers d’environnement décrits dans la section suivante, puis préparez Prisma :

```bash
npm --prefix backend run prisma:generate
npm --prefix backend run prisma:push
```

Démarrez le backend dans un terminal :

```bash
npm run backend:dev
```

Démarrez ensuite le frontend dans un second terminal :

```bash
npm run dev
```

Le frontend est servi sur le port `8080` et appelle par défaut le backend sur `http://localhost:3001`.

## Configuration des variables d’environnement

Ne versionnez jamais les fichiers `.env` ni les clés de service. Utilisez exclusivement des valeurs locales ou injectées par votre plateforme de déploiement.

### Frontend — `.env`

Créez un fichier `.env` à la racine du projet :

```dotenv
VITE_API_URL=http://localhost:3001
VITE_GOOGLE_MAPS_API_KEY=votre-cle-google-maps
```

| Variable | Requise | Description |
| --- | --- | --- |
| `VITE_API_URL` | Non | URL publique de l’API. La valeur par défaut est `http://localhost:3001`. |
| `VITE_GOOGLE_MAPS_API_KEY` | Oui | Clé utilisée pour charger Google Maps dans le navigateur. Restreignez-la au domaine de l’application. |

> Toute variable Vite préfixée par `VITE_` est exposée au navigateur. N’y placez jamais de secret côté serveur.

### Backend — `backend/.env`

Copiez `backend/.env.example` vers `backend/.env`, puis renseignez les valeurs adaptées à votre environnement :

```dotenv
DATABASE_URL=postgresql://utilisateur:mot_de_passe@hote:5432/agrisat?schema=public
GEE_SERVICE_ACCOUNT_KEY={"type":"service_account","project_id":"votre-projet",...}
HF_MODEL_URL=https://votre-modele.example
GOOGLE_MAPS_API_KEY=votre-cle-google-maps
PORT=3001
HOST=0.0.0.0
FRONTEND_ORIGIN=http://localhost:8080
```

| Variable | Requise | Description |
| --- | --- | --- |
| `DATABASE_URL` | Oui | Chaîne de connexion PostgreSQL utilisée par Prisma. |
| `GEE_SERVICE_ACCOUNT_KEY` | Oui | JSON complet du compte de service Google Earth Engine, sur une seule ligne. |
| `HF_MODEL_URL` | Oui | URL du service de classification orge / non-orge. |
| `GOOGLE_MAPS_API_KEY` | Oui | Clé utilisée pour récupérer l’image satellite transmise au modèle. |
| `PORT` | Non | Port d’écoute du backend. Valeur par défaut : `3001`. |
| `HOST` | Non | Hôte d’écoute du backend. Valeur par défaut : `0.0.0.0`. |
| `FRONTEND_ORIGIN` | Non | Origines autorisées par CORS, séparées par des virgules si nécessaire. |

## Structure du projet

```text
.
├── src/                         # Application frontend React
│   ├── components/               # Composants métier et composants UI
│   │   ├── SatelliteMap.tsx      # Carte, géolocalisation et interactions
│   │   ├── PolygonDrawer.tsx     # Dessin de parcelles
│   │   ├── AnalysisPopup.tsx     # Lancement et restitution de l’analyse
│   │   └── ui/                   # Composants de base Radix / shadcn
│   ├── hooks/
│   │   └── useParcelles.ts       # Lecture, création et suppression via l’API
│   ├── pages/
│   │   ├── Index.tsx             # Carte satellite (`/`)
│   │   ├── Dashboard.tsx         # Tableau de bord (`/dashboard`)
│   │   └── NotFound.tsx          # Route de secours
│   ├── lib/utils.ts              # Utilitaires frontend
│   ├── App.tsx                   # Providers et routes React
│   └── main.tsx                  # Point d’entrée React
├── backend/                      # API TypeScript Fastify
│   ├── prisma/schema.prisma      # Modèle de données PostgreSQL
│   ├── src/server.ts             # Serveur et routes REST
│   └── src/analyze-parcel.ts     # Earth Engine, indices et classification
├── tailwind.config.ts            # Thème et analyse Tailwind CSS
├── vite.config.ts                # Configuration Vite et alias `@/`
└── README.md                     # Documentation du projet
```

## API backend

L’API est définie dans `backend/src/server.ts`.

| Méthode | Route | Description |
| --- | --- | --- |
| `GET` | `/health` | Vérifie que le serveur répond. |
| `GET` | `/api/parcelles` | Retourne les parcelles enregistrées, de la plus récente à la plus ancienne. |
| `POST` | `/api/parcelles` | Enregistre une parcelle et son résultat d’analyse. |
| `DELETE` | `/api/parcelles/:id` | Supprime une parcelle par son identifiant UUID. |
| `POST` | `/api/analyze-parcel` | Lance l’analyse satellite et la classification d’une parcelle. |

Le modèle Prisma `Parcelle` est décrit dans `backend/prisma/schema.prisma`. Il stocke notamment la géométrie, les indices spectraux (NDVI, EVI, SAVI, NDWI), les séries temporelles, les scores et le verdict.

## Flux d’analyse d’une parcelle

1. L’utilisateur saisit des coordonnées ou dessine un polygone dans Google Maps.
2. Le frontend appelle `POST /api/analyze-parcel` avec le centre, le niveau de zoom et la géométrie.
3. Le backend récupère les données Sentinel-1 et Sentinel-2 via Google Earth Engine.
4. Il calcule les indices spectraux et une série temporelle sur six mois.
5. Il capture une image satellite et l’envoie au modèle de classification.
6. Il combine le score du modèle et les règles agronomiques pour produire un verdict.
7. Après confirmation dans l’interface, le frontend enregistre la parcelle via `POST /api/parcelles`.
8. La carte et le tableau de bord récupèrent les parcelles enregistrées via `GET /api/parcelles`.

## Scripts disponibles

### Racine du projet

| Commande | Description |
| --- | --- |
| `npm run dev` | Lance le frontend Vite. |
| `npm run build` | Produit le build de production du frontend. |
| `npm run lint` | Exécute ESLint. |
| `npm run test` | Lance les tests Vitest une fois. |
| `npm run test:watch` | Lance Vitest en mode surveillance. |
| `npm run backend:dev` | Lance le backend en développement. |
| `npm run backend:build` | Compile le backend TypeScript. |

### Dossier `backend`

| Commande | Description |
| --- | --- |
| `npm run dev` | Lance Fastify avec rechargement automatique. |
| `npm run build` | Compile le backend dans `backend/dist`. |
| `npm run prisma:generate` | Génère le client Prisma. |
| `npm run prisma:push` | Synchronise le schéma Prisma avec la base de données. |
| `npm run start` | Lance le backend compilé. |

## Développement et vérifications

- Utilisez l’alias `@/` pour les imports issus de `src/`.
- Les composants métier sont dans `src/components/` ; conservez les composants génériques dans `src/components/ui/`.
- Toute évolution du schéma doit être faite dans `backend/prisma/schema.prisma`, suivie de `npm --prefix backend run prisma:generate`.
- Exécutez `npm run lint`, `npm run test`, `npm run build` et `npm run backend:build` avant une livraison.
- Vérifiez manuellement le parcours principal : chargement de la carte, tracé d’une parcelle, analyse, enregistrement et affichage dans le tableau de bord.
- En production, définissez `VITE_API_URL` et `FRONTEND_ORIGIN` avec les URL publiques correspondantes et restreignez les clés Google aux services et origines nécessaires.
