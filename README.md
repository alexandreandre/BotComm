# cinecontent-bot-dispatcher

Backend bot cloud en TypeScript/Node.js pour executer des runs Playwright, uploader les artefacts dans Supabase Storage, puis callback `bot-webhook`.

## Choix d'architecture V1

V1 implemente **un seul Cloud Run Service HTTP** (`cinecontent-bot-dispatcher`) avec endpoint `/dispatch`.

Pourquoi ce choix :
- branchement le plus rapide a Lovable/Supabase (une seule URL a appeler),
- moins de complexite operationnelle (pas de coordination dispatcher/job),
- robustesse suffisante pour une V1 avec timeout global, limite de concurrence, retries webhook et logs structures.

Le service repond rapidement `202 accepted`, puis execute le run en asynchrone dans le meme process.

## Architecture

- **Control plane** : Lovable + Supabase (strategie, run, approval, publish flow).
- **Execution plane** : ce service Cloud Run.
- **Storage** : Supabase Storage (`storage_bucket` + `storage_path` venant du payload).
- **Callback final** : `webhook_url` (`bot-webhook`) avec `callback_token` retourne tel quel.

## Structure du projet

```text
src/
  index.ts
  app.ts
  config/
    env.ts
  domain/
    types.ts
    schemas.ts
  core/
    logger.ts
    errors.ts
    result.ts
  services/
    dispatch-run.service.ts
    run-bot.service.ts
    webhook.service.ts
    storage.service.ts
    screenshot.service.ts
    video.service.ts
  games/
    base/
      game-adapter.ts
    movie-quiz/
      adapter.ts
      selectors.ts
      parser.ts
      strategy.ts
    registry.ts
  http/
    routes/
      health.route.ts
      dispatch.route.ts
    controllers/
      dispatch.controller.ts
    middleware/
      error-handler.ts
  utils/
    time.ts
    retry.ts
    sanitize.ts
```

## Contrat d'entree `/dispatch`

`POST /dispatch`

```json
{
  "run_id": "uuid-du-run",
  "callback_token": "uuid-secret-usage-unique",
  "webhook_url": "https://<supabase-project>.supabase.co/functions/v1/bot-webhook",
  "game_url": "https://example.com/game",
  "game": "Movie Quiz",
  "bot_goal": "Repondre correctement a un maximum de questions",
  "max_duration_seconds": 60,
  "storage_bucket": "gameplay-videos",
  "storage_path": "{user_id}/{run_id}"
}
```

Reponse API :

```json
{
  "ok": true,
  "run_id": "uuid-du-run",
  "status": "accepted"
}
```

## Contrat de callback sortant

Succes :

```json
{
  "run_id": "uuid-du-run",
  "callback_token": "uuid-secret-recu-a-l'entree",
  "status": "completed",
  "score": 450,
  "streak": 8,
  "duration": 95,
  "video_path": "{user_id}/{run_id}/raw.webm",
  "screenshots": ["{user_id}/{run_id}/screenshot_1.png"],
  "events": [
    { "event_type": "start", "description": "Debut de la partie" },
    { "event_type": "gameplay", "description": "Reponse envoyee" },
    { "event_type": "end", "description": "Score final extrait", "data": { "score": 450 } }
  ],
  "error_message": null
}
```

Echec :

```json
{
  "run_id": "uuid-du-run",
  "callback_token": "uuid-secret-recu-a-l'entree",
  "status": "failed",
  "error_message": "Timeout: run exceeded 65s"
}
```

## Variables d'environnement

Copier `.env.example` vers `.env` pour du local.

- `PORT` : port HTTP (`8080` par defaut).
- `NODE_ENV` : `development|test|production`.
- `LOG_LEVEL` : niveau pino.
- `BODY_LIMIT_BYTES` : limite taille payload HTTP.
- `SUPABASE_URL` : URL du projet Supabase.
- `SUPABASE_SERVICE_ROLE_KEY` : cle serveur pour upload Storage.
- `DEFAULT_STORAGE_BUCKET` : fallback bucket.
- `PLAYWRIGHT_HEADLESS` : `true|false`.
- `PLAYWRIGHT_NAV_TIMEOUT_MS` : timeout navigation.
- `WEBHOOK_TIMEOUT_MS` : timeout callback HTTP.
- `WEBHOOK_MAX_RETRIES` : nombre de retries webhook.
- `MAX_RUN_TIMEOUT_MS` : plafond timeout run global.
- `RUN_CONCURRENCY_LIMIT` : nombre de runs simultanes max.

## Scripts npm

- `npm run dev` : mode developpement (`tsx watch`).
- `npm run build` : compilation TypeScript.
- `npm run start` : execution build `dist/`.
- `npm run typecheck` : verification TS stricte.

## Lancement local

1. Installer dependances :
   ```bash
   npm install
   npx playwright install chromium
   ```
2. Configurer `.env`.
3. Demarrer :
   ```bash
   npm run dev
   ```
4. Healthcheck :
   ```bash
   curl http://localhost:8080/healthz
   ```

## Docker (Cloud Run)

Build local :

```bash
docker build -t cinecontent-bot-dispatcher:local .
docker run --rm -p 8080:8080 --env-file .env cinecontent-bot-dispatcher:local
```

Le `Dockerfile` est base sur l'image Playwright officielle pour fiabiliser Chromium en environnement conteneurise.

## Deploiement Google Cloud Run via GitHub Actions

Workflow : `.github/workflows/deploy-cloud-run.yml` (trigger: push sur `main`).

### Secrets GitHub requis

- `GCP_WORKLOAD_IDENTITY_PROVIDER`
- `GCP_SERVICE_ACCOUNT`
- `SUPABASE_URL`

### Variables GitHub (`Repository Variables`) requises

- `GCP_PROJECT_ID`
- `GCP_REGION` (ex: `europe-west1`)
- `ARTIFACT_REPO` (ex: `cloud-run-images`)
- `CLOUD_RUN_SERVICE` (ex: `cinecontent-bot-dispatcher`)
- `DEFAULT_STORAGE_BUCKET` (ex: `gameplay-videos`)

### Secret Manager Google Cloud recommande

Creer un secret GCP nomme `SUPABASE_SERVICE_ROLE_KEY` (version `latest`), utilise par :

```bash
--set-secrets "SUPABASE_SERVICE_ROLE_KEY=SUPABASE_SERVICE_ROLE_KEY:latest"
```

## Securite et robustesse

- Validation stricte `zod` des payloads entrants.
- Aucune cle sensible hardcodee.
- Logs structures `pino` avec champs sensibles redactes.
- Timeout global de run + timeout/retry webhook.
- Callback `failed` tente systematiquement en cas d'erreur de run.
- Nettoyage ressources garanti (`context.close`, `browser.close`, suppression dossier temp).

## Branchement avec Lovable/Supabase

1. Depuis ton edge function `play-game`, appeler `POST /dispatch` avec le payload contractuel.
2. `webhook_url` doit pointer vers `.../functions/v1/bot-webhook`.
3. `callback_token` est renvoye tel quel dans le callback final.
4. `storage_bucket` + `storage_path` gouvernent la destination des artefacts.

## Ajouter un nouvel adapter de jeu

1. Creer `src/games/<new-game>/` avec `selectors.ts`, `strategy.ts`, `adapter.ts`.
2. Implementer `GameAdapter` (`init/start/play/extractScore/extractStreak/isGameOver`).
3. Enregistrer l'adapter dans `src/games/registry.ts`.
4. Ajouter des evenements explicites pour faciliter l'observabilite et le debug.

## Limitations V1 (documentees volontairement)

- Adapter `movie-quiz` fourni en base demo avec selecteurs placeholders.
- Pour un jeu reel, ajuster les selecteurs/strategie selon le DOM exact.
- La V1 execute dans le process HTTP (pas encore de Cloud Run Jobs separes).
