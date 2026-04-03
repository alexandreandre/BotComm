import { z } from "zod";
import { insertActivityLog } from "../../api/activity-log";
import { getSupabaseAdmin } from "../../api/supabase-auth";
import { env } from "../../config/env";
import { generateCaptionsWithGemini } from "../gemini.service";
import type { StorageService } from "../storage.service";

const completedWebhookSchema = z
  .object({
    run_id: z.string().uuid(),
    callback_token: z.string().uuid(),
    status: z.literal("completed"),
    score: z.number(),
    streak: z.number(),
    duration: z.number().int().nonnegative(),
    events: z
      .array(
        z.object({
          event_type: z.string(),
          description: z.string().optional().default(""),
          data: z.record(z.string(), z.any()).optional().default({})
        })
      )
      .optional()
      .default([]),
    video_path: z.string().min(1),
    error_message: z.null().optional()
  })
  .passthrough();

const failedWebhookSchema = z
  .object({
    run_id: z.string().uuid(),
    callback_token: z.string().uuid(),
    status: z.literal("failed"),
    error_message: z.string().min(1)
  })
  .passthrough();

export const botWebhookBodySchema = z.discriminatedUnion("status", [
  completedWebhookSchema,
  failedWebhookSchema
]);

export type BotWebhookBody = z.infer<typeof botWebhookBodySchema>;

function viralScore(score: number, streak: number): number {
  const jitter = Math.floor(Math.random() * 20);
  return Math.min(100, Math.floor(score / 10 + streak * 3 + jitter));
}

function storageBucketForPublicUrl(): string {
  if (env.STORAGE_BACKEND === "gcs") {
    return env.GCS_BUCKET ?? env.DEFAULT_STORAGE_BUCKET;
  }
  return env.DEFAULT_STORAGE_BUCKET;
}

type RunWithStrategy = {
  user_id: string;
  strategy_id: string;
  game: string;
  bot_goal: string | null;
  content_strategies: {
    caption_style: string;
    platforms: string[] | null;
    game: string;
  } | null;
};

export async function processBotWebhook(
  body: BotWebhookBody,
  storageService: StorageService
): Promise<{ success: boolean; run_id: string; clip_id?: string; status: string }> {
  const sb = getSupabaseAdmin();

  const { data: run, error: fetchErr } = await sb
    .from("runs")
    .select(
      `
      user_id,
      strategy_id,
      game,
      bot_goal,
      content_strategies (
        caption_style,
        platforms,
        game
      )
    `
    )
    .eq("id", body.run_id)
    .eq("bot_callback_token", body.callback_token)
    .eq("status", "running")
    .maybeSingle();

  if (fetchErr) {
    throw fetchErr;
  }

  if (!run) {
    return { success: false, run_id: body.run_id, status: "invalid_token" };
  }

  const row = run as unknown as RunWithStrategy;
  const userId = row.user_id;
  const strat = row.content_strategies;

  if (body.status === "failed") {
    const { data: updRows, error: updErr } = await sb
      .from("runs")
      .update({
        status: "failed",
        summary: body.error_message,
        completed_at: new Date().toISOString(),
        bot_callback_token: null
      })
      .eq("id", body.run_id)
      .eq("bot_callback_token", body.callback_token)
      .eq("status", "running")
      .select("id");

    if (updErr) {
      throw updErr;
    }
    if (!updRows?.length) {
      return { success: false, run_id: body.run_id, status: "invalid_token" };
    }

    await insertActivityLog({
      userId,
      level: "error",
      category: "run",
      message: `Run échoué : ${body.error_message}`,
      entityId: body.run_id,
      entityType: "run"
    });
    return { success: true, run_id: body.run_id, status: "failed" };
  }

  const bucket = storageBucketForPublicUrl();
  const rawVideoUrl = storageService.publicUrlForPath(bucket, body.video_path);

  const vScore = viralScore(body.score, body.streak);
  const captionStyle = strat?.caption_style ?? "punchy";
  const gameName = row.game || strat?.game || "Jeu";
  const botGoal = row.bot_goal ?? "";

  const captions = await generateCaptionsWithGemini({
    game: gameName,
    captionStyle,
    score: body.score,
    streak: body.streak,
    duration: body.duration,
    botGoal
  });

  const hashtags = (captions.hashtags ?? []).slice(0, 8);
  while (hashtags.length < 5) {
    hashtags.push("viral");
  }

  const platforms = strat?.platforms;
  const platform = platforms?.[0] === "instagram" ? "instagram" : "tiktok";

  const { data: runUpd, error: runUpdErr } = await sb
    .from("runs")
    .update({
      status: "completed",
      score: body.score,
      streak: body.streak,
      duration: body.duration,
      viral_score: vScore,
      raw_video_url: rawVideoUrl,
      completed_at: new Date().toISOString(),
      bot_callback_token: null
    })
    .eq("id", body.run_id)
    .eq("bot_callback_token", body.callback_token)
    .eq("status", "running")
    .select("id");

  if (runUpdErr) {
    throw runUpdErr;
  }
  if (!runUpd?.length) {
    return { success: false, run_id: body.run_id, status: "invalid_token" };
  }

  if (body.events.length > 0) {
    const { error: evErr } = await sb.from("run_events").insert(
      body.events.map((ev) => ({
        run_id: body.run_id,
        event_type: ev.event_type,
        description: ev.description ?? "",
        data: ev.data ?? {}
      }))
    );
    if (evErr) {
      throw evErr;
    }
  }

  const { data: clipRow, error: clipErr } = await sb
    .from("clips")
    .insert({
      user_id: userId,
      run_id: body.run_id,
      strategy_id: row.strategy_id,
      game: gameName,
      platform,
      status: "ready_for_approval",
      caption: captions.caption,
      hashtags,
      first_comment: captions.first_comment,
      duration: body.duration,
      video_url: rawVideoUrl
    })
    .select("id")
    .single();

  if (clipErr || !clipRow) {
    throw clipErr ?? new Error("Insert clip failed");
  }

  const clipId = clipRow.id as string;

  await insertActivityLog({
    userId,
    level: "success",
    category: "caption",
    message: "Run terminé, clip prêt pour review",
    entityId: clipId,
    entityType: "clip"
  });

  return { success: true, run_id: body.run_id, clip_id: clipId, status: "completed" };
}
