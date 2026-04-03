# CineContent — Bot + plateforme (Google Cloud + Supabase)

Monorepo : **un seul service Cloud Run** sur le port **8080** — **dispatcher Playwright** (`POST /dispatch`), **API Fastify** (`/api/*`, webhook bot) et **SPA** (dashboard servie en statique par Fastify depuis `FRONTEND_DIST_PATH`). **Auth = Supabase Auth** (JWT). **Données = Postgres Supabase** + **Storage Supabase** (ou GCS). **IA = Gemini** (optionnel).

## Architecture

| Couche | Rôle |
|--------|------|
| **Frontend** (`frontend/`) | React + Vite + Tailwind + TanStack Query + **Supabase Auth** (`anon` key) |
| **Backend** (`src/`) | Fastify 5 : `/dispatch`, `/api/*`, `POST /api/webhooks/bot`, health |
| **Bot** | Playwright, upload vidéo, callback webhook |
| **Données** | Schéma `db/migrations/001_init.sql` (RLS, `auth.users`, Storage, Realtime) |

En production Docker, le build Vite est inclus dans l’image (`FRONTEND_DIST_PATH`).

## Démarrage local

### 1. Base Supabase

Le fichier `db/migrations/001_init.sql` cible un **projet Supabase** (`auth.users`, `storage`, publication `supabase_realtime`). Sur une base vide, exécute-le dans le **SQL Editor** ou :

```bash
export DATABASE_URL='postgresql://postgres:...@db.xxxx.supabase.co:5432/postgres'
npm run db:migrate
```

Si ton projet contient **déjà** ce schéma (ex. export Lovable), ne réapplique pas le script sans vérifier les conflits.

### 2. API + bot

```bash
cp .env.example .env
# DATABASE_URL, PUBLIC_APP_URL, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, STORAGE_BACKEND, etc.
npm install
npx playwright install chromium
npm run dev
```

### 3. Frontend

```bash
cd frontend
cp .env.example .env.local
# VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY — laisser VITE_API_BASE_URL vide pour proxy → :8080
npm install
npm run dev
```

- API : [http://localhost:8080](http://localhost:8080)  
- UI : [http://localhost:5173](http://localhost:5173)

## Variables d’environnement (API)

Voir `.env.example`.

- **`SUPABASE_URL`** + **`SUPABASE_SERVICE_ROLE_KEY`** : obligatoires si **`DATABASE_URL`** est défini (vérification JWT `Bearer` sur `/api/*`) ; aussi pour Storage si `STORAGE_BACKEND=supabase`.
- **`PUBLIC_APP_URL`** : URL du service pour le webhook bot (`play-game`).
- **`DATABASE_SSL`** : `auto` | `true` | `false` (auto active SSL pour les hôtes Supabase).
- **`GEMINI_API_KEY`** : optionnel.

## Supabase : clés et dashboard

### À mettre dans ton `.env` / Cloud Run (valeurs lues **depuis** Supabase)

| Variable | Source dashboard |
|----------|------------------|
| `DATABASE_URL` | **Settings → Database → Connection string → URI** (direct `:5432` ou session pooler recommandé pour Node) |
| `SUPABASE_URL` | **Settings → API → Project URL** |
| `SUPABASE_SERVICE_ROLE_KEY` | **Settings → API → service_role** (serveur uniquement) |
| `DEFAULT_STORAGE_BUCKET` | ex. `gameplay-videos` |

### Frontend (`.env.local` / build Docker)

| Variable | Source |
|----------|--------|
| `VITE_SUPABASE_URL` | = `SUPABASE_URL` |
| `VITE_SUPABASE_ANON_KEY` | **Settings → API → anon public** |

Ne jamais exposer la **service_role** dans le bundle Vite.

### Dans le dashboard Supabase

- Bucket **`gameplay-videos`** (public si tu utilises des URLs publiques).
- **Auth** : activer email/password si besoin.
- **Realtime** : `runs` et `clips` sont ajoutés à la publication dans la migration.

## Endpoints API (résumé)

| Méthode | Chemin | Auth |
|---------|--------|------|
| POST | `/api/webhooks/bot` | corps JSON (`callback_token`, `run_id`, …) |
| POST | `/api/runs/play` | Bearer = access token Supabase |
| POST | `/api/ai/generate-strategy` | Bearer Supabase |
| CRUD | `/api/strategies`, `/api/runs`, `/api/clips`, … | Bearer Supabase |

## Docker & Cloud Run

```bash
docker build -t cinecontent:local \
  --build-arg VITE_SUPABASE_URL=https://xxx.supabase.co \
  --build-arg VITE_SUPABASE_ANON_KEY=eyJ... \
  .
docker run --rm -p 8080:8080 --env-file .env cinecontent:local
```

Les `VITE_*` sont figées au **build** de l’image.

### GitHub Actions (déploiement)

Le workflow `.github/workflows/deploy-cloud-run.yml` construit **une image** (frontend Vite + backend TypeScript + Playwright) et déploie **un seul** service Cloud Run.

#### Secrets GitHub (Settings → Secrets and variables → Actions)

| Secret | Rôle |
|--------|------|
| **`GCP_SA_KEY`** | JSON du compte de service GCP (Artifact Registry + Cloud Run + idéalement accès Secret Manager). |
| **`SUPABASE_URL`** | URL projet Supabase (ex. `https://xxx.supabase.co`). *Option* : la mettre en variable **`VITE_SUPABASE_URL`** à la place. |
| **`SUPABASE_ANON_KEY`** | Clé **anon** (public) pour le build Vite. *Option* : variable **`VITE_SUPABASE_PUBLISHABLE_KEY`**. |

#### Variables GitHub (repository *ou* organization)

| Variable | Obligatoire | Rôle |
|----------|-------------|------|
| **`GCP_PROJECT_ID`** | oui | ID projet GCP. |
| **`PUBLIC_APP_URL`** | fortement recommandé | URL publique du service Cloud Run **sans slash final** (ex. `https://mon-service-xxxxx-ew.a.run.app`), pour les webhooks bot (`play-game`). À aligner sur l’URL réelle après le premier déploiement (ou domaine custom). |
| **`GCP_REGION`** | non | Défaut : `europe-west1`. |
| **`ARTIFACT_REPO`** | non | Défaut : `cloud-run-images` (doit exister dans Artifact Registry). |
| **`CLOUD_RUN_SERVICE`** ou **`BACKEND_SERVICE_NAME`** | non | Nom du service Cloud Run ; défaut : `cinecontent-bot-dispatcher`. |
| **`VITE_SUPABASE_URL`** | si pas secret `SUPABASE_URL` | Même valeur que l’URL projet Supabase. |
| **`VITE_SUPABASE_PUBLISHABLE_KEY`** | si pas secret `SUPABASE_ANON_KEY` | Clé anon pour le build. |
| **`STORAGE_BACKEND`** | non | `supabase` (défaut) ou `gcs`. |
| **`DEFAULT_STORAGE_BUCKET`** | non | Défaut : `gameplay-videos`. |
| **`GCS_BUCKET`** | si `STORAGE_BACKEND=gcs` | Nom du bucket GCS. |

#### Google Secret Manager (référencés par `--set-secrets` au déploiement)

Crée ces secrets **dans le même projet GCP** ; le compte de service Cloud Run doit avoir **Secret Manager Secret Accessor** dessus.

| Nom du secret (GCP) | Contenu |
|---------------------|---------|
| **`SUPABASE_SERVICE_ROLE_KEY`** | Clé **service_role** Supabase (jamais dans GitHub ni dans le frontend). |
| **`DATABASE_URL`** | Chaîne Postgres Supabase (direct `:5432` ou pooler). |

Optionnel ensuite : ajouter **`GEMINI_API_KEY`** (Secret Manager + entrée dans `gcloud run deploy --set-secrets`) si tu utilises l’IA côté API.

## Structure

```text
db/migrations/001_init.sql   # Schéma Supabase complet
frontend/
src/api/supabase-auth.ts     # Vérif JWT via GoTrue (service role)
```

## Contrat `POST /dispatch` (bot)

```json
{
  "run_id": "uuid",
  "callback_token": "uuid",
  "webhook_url": "https://<service>/api/webhooks/bot",
  "game_url": "https://...",
  "game": "Movie Quiz",
  "bot_goal": "...",
  "max_duration_seconds": 60,
  "storage_bucket": "gameplay-videos",
  "storage_path": "{user_id}/{run_id}"
}
```

## Scripts npm (racine)

- `npm run dev` — API + bot
- `npm run build` — compile `src/`
- `npm run db:migrate` — applique `001_init.sql` (nécessite `DATABASE_URL` Supabase)

## Limitations

- Adapters jeu : sélecteurs à caler sur le DOM réel.
- Publication réseaux sociaux : simulation.
- Rendu clip : placeholder.
