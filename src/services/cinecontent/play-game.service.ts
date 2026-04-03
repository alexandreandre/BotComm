import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { insertActivityLog } from "../../api/activity-log";
import { env, requirePublicAppUrl } from "../../config/env";
import { AppError } from "../../core/errors";
import type { DispatchRunService } from "../dispatch-run.service";
import type { StorageService } from "../storage.service";

export async function playGameForUser(
  client: PoolClient,
  userId: string,
  strategyId: string,
  dispatchRunService: DispatchRunService,
  _storageService: StorageService
): Promise<{ run: Record<string, unknown>; bot_dispatched: boolean; message: string }> {
  const sRes = await client.query(
    `SELECT * FROM content_strategies WHERE id = $1 AND user_id = $2`,
    [strategyId, userId]
  );
  if (sRes.rowCount === 0) {
    throw new AppError("Stratégie introuvable", { code: "NOT_FOUND", statusCode: 404 });
  }
  const strategy = sRes.rows[0] as Record<string, unknown>;
  const gameUrl = (strategy["game_url"] as string)?.trim();
  if (!gameUrl) {
    throw new AppError("game_url requis sur la stratégie", { code: "VALIDATION", statusCode: 400 });
  }

  const token = randomUUID();
  const runInsert = await client.query(
    `INSERT INTO runs (
      user_id, strategy_id, game, theme, bot_goal, status, bot_callback_token
    ) VALUES (
      $1, $2, $3, $4, $5, 'pending'::run_status, $6
    ) RETURNING *`,
    [
      userId,
      strategyId,
      strategy["game"] as string,
      (strategy["theme"] as string) ?? "",
      (strategy["bot_goal"] as string) ?? "",
      token
    ]
  );

  const run = runInsert.rows[0] as Record<string, unknown>;
  const runId = run["id"] as string;

  await insertActivityLog(client, {
    userId,
    level: "info",
    category: "run",
    message: "Run créé, envoi au bot",
    entityId: runId,
    entityType: "run"
  });

  const baseUrl = requirePublicAppUrl();
  const webhookUrl = `${baseUrl}/api/webhooks/bot`;
  const storagePath = `${userId}/${runId}`;
  const maxDuration = Math.min(
    Math.floor(env.MAX_RUN_TIMEOUT_MS / 1000),
    Math.max(30, Number(strategy["target_clip_duration"] ?? 60))
  );

  const storageBucket =
    env.STORAGE_BACKEND === "gcs" ? (env.GCS_BUCKET ?? env.DEFAULT_STORAGE_BUCKET) : env.DEFAULT_STORAGE_BUCKET;

  let botDispatched = false;
  let message = "Run accepté par le dispatcher";

  try {
    dispatchRunService.dispatch({
      run_id: runId,
      callback_token: token,
      webhook_url: webhookUrl,
      game_url: gameUrl,
      game: String(strategy["game"]),
      bot_goal: String(strategy["bot_goal"] ?? ""),
      max_duration_seconds: maxDuration,
      storage_bucket: storageBucket,
      storage_path: storagePath
    });
    botDispatched = true;
  } catch (e) {
    if (e instanceof AppError && e.code === "RUN_LIMIT") {
      await client.query(
        `UPDATE runs SET status = 'failed'::run_status, summary = $2, updated_at = now() WHERE id = $1`,
        [runId, "Limite de concurrence bot atteinte"]
      );
      await insertActivityLog(client, {
        userId,
        level: "error",
        category: "run",
        message: "Dispatcher saturé",
        entityId: runId,
        entityType: "run"
      });
      return {
        run: { ...run, status: "failed", summary: "Limite de concurrence bot atteinte" },
        bot_dispatched: false,
        message: e.message
      };
    }
    await client.query(
      `UPDATE runs SET status = 'failed'::run_status, summary = $2, updated_at = now() WHERE id = $1`,
      [runId, e instanceof Error ? e.message : "Erreur dispatch"]
    );
    throw e;
  }

  await client.query(
    `UPDATE runs SET status = 'running'::run_status, updated_at = now() WHERE id = $1`,
    [runId]
  );

  const updated = await client.query(`SELECT * FROM runs WHERE id = $1`, [runId]);
  return {
    run: updated.rows[0] as Record<string, unknown>,
    bot_dispatched: botDispatched,
    message
  };
}
