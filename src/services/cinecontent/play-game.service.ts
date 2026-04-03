import { randomUUID } from "node:crypto";
import { insertActivityLog } from "../../api/activity-log";
import { getSupabaseAdmin } from "../../api/supabase-auth";
import { env, requirePublicAppUrl } from "../../config/env";
import { AppError } from "../../core/errors";
import type { DispatchRunService } from "../dispatch-run.service";
import type { StorageService } from "../storage.service";

export async function playGameForUser(
  userId: string,
  strategyId: string,
  dispatchRunService: DispatchRunService,
  _storageService: StorageService
): Promise<{ run: Record<string, unknown>; bot_dispatched: boolean; message: string }> {
  const sb = getSupabaseAdmin();
  const { data: strategy, error: sErr } = await sb
    .from("content_strategies")
    .select("*")
    .eq("id", strategyId)
    .eq("user_id", userId)
    .maybeSingle();

  if (sErr) {
    throw sErr;
  }
  if (!strategy) {
    throw new AppError("Stratégie introuvable", { code: "NOT_FOUND", statusCode: 404 });
  }

  const gameUrl = String(strategy.game_url ?? "").trim();
  if (!gameUrl) {
    throw new AppError("game_url requis sur la stratégie", { code: "VALIDATION", statusCode: 400 });
  }

  const token = randomUUID();
  const { data: run, error: insErr } = await sb
    .from("runs")
    .insert({
      user_id: userId,
      strategy_id: strategyId,
      game: strategy.game as string,
      theme: (strategy.theme as string) ?? "",
      bot_goal: (strategy.bot_goal as string) ?? "",
      status: "pending",
      bot_callback_token: token
    })
    .select()
    .single();

  if (insErr || !run) {
    throw insErr ?? new Error("Insert run failed");
  }

  const runId = run.id as string;

  await insertActivityLog({
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
    Math.max(30, Number(strategy.target_clip_duration ?? 60))
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
      game: String(strategy.game),
      bot_goal: String(strategy.bot_goal ?? ""),
      max_duration_seconds: maxDuration,
      storage_bucket: storageBucket,
      storage_path: storagePath
    });
    botDispatched = true;
  } catch (e) {
    if (e instanceof AppError && e.code === "RUN_LIMIT") {
      await sb
        .from("runs")
        .update({ status: "failed", summary: "Limite de concurrence bot atteinte" })
        .eq("id", runId);
      await insertActivityLog({
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
    await sb
      .from("runs")
      .update({ status: "failed", summary: e instanceof Error ? e.message : "Erreur dispatch" })
      .eq("id", runId);
    throw e;
  }

  const { data: updated, error: upErr } = await sb.from("runs").update({ status: "running" }).eq("id", runId).select().single();

  if (upErr || !updated) {
    throw upErr ?? new Error("Update run failed");
  }

  return {
    run: updated as Record<string, unknown>,
    bot_dispatched: botDispatched,
    message
  };
}
