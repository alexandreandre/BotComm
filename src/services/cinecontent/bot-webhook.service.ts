import { z } from "zod";
import type { PoolClient } from "pg";
import { insertActivityLog } from "../../api/activity-log";
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

export async function processBotWebhook(
  body: BotWebhookBody,
  client: PoolClient,
  storageService: StorageService
): Promise<{ success: boolean; run_id: string; clip_id?: string; status: string }> {
  const runRes = await client.query(
    `SELECT r.*, s.caption_style::text AS caption_style, s.platforms, s.game AS strategy_game
     FROM runs r
     JOIN content_strategies s ON s.id = r.strategy_id
     WHERE r.id = $1 AND r.bot_callback_token = $2 AND r.status = 'running'::run_status`,
    [body.run_id, body.callback_token]
  );

  if (!runRes.rowCount) {
    return { success: false, run_id: body.run_id, status: "invalid_token" };
  }

  const run = runRes.rows[0] as Record<string, unknown>;
  const userId = run["user_id"] as string;

  if (body.status === "failed") {
    const upd = await client.query(
      `UPDATE runs SET
        status = 'failed'::run_status,
        summary = $2,
        completed_at = now(),
        bot_callback_token = NULL,
        updated_at = now()
       WHERE id = $1 AND bot_callback_token = $3 AND status = 'running'::run_status`,
      [body.run_id, body.error_message, body.callback_token]
    );
    if (!upd.rowCount) {
      return { success: false, run_id: body.run_id, status: "invalid_token" };
    }
    await insertActivityLog(client, {
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
  const captionStyle = (run["caption_style"] as string) ?? "punchy";
  const gameName = (run["game"] as string) || (run["strategy_game"] as string) || "Jeu";
  const botGoal = (run["bot_goal"] as string) ?? "";

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

  const platforms = run["platforms"] as string[] | null;
  const platform = platforms?.[0] === "instagram" ? "instagram" : "tiktok";

  await client.query("BEGIN");
  try {
    const runUpd = await client.query(
      `UPDATE runs SET
        status = 'completed'::run_status,
        score = $2,
        streak = $3,
        duration = $4,
        viral_score = $5,
        raw_video_url = $6,
        completed_at = now(),
        bot_callback_token = NULL,
        updated_at = now()
       WHERE id = $1 AND bot_callback_token = $7 AND status = 'running'::run_status`,
      [body.run_id, body.score, body.streak, body.duration, vScore, rawVideoUrl, body.callback_token]
    );
    if (!runUpd.rowCount) {
      await client.query("ROLLBACK");
      return { success: false, run_id: body.run_id, status: "invalid_token" };
    }

    for (const ev of body.events) {
      await client.query(
        `INSERT INTO run_events (run_id, event_type, description, data)
         VALUES ($1, $2, $3, $4::jsonb)`,
        [body.run_id, ev.event_type, ev.description ?? "", JSON.stringify(ev.data ?? {})]
      );
    }

    const clipRes = await client.query(
      `INSERT INTO clips (
        user_id, run_id, strategy_id, game, platform, status,
        caption, hashtags, first_comment, duration, video_url
      ) VALUES (
        $1, $2, $3, $4, $5::platform, 'ready_for_approval'::clip_status,
        $6, $7::text[], $8, $9, $10
      ) RETURNING id`,
      [
        userId,
        body.run_id,
        run["strategy_id"],
        gameName,
        platform,
        captions.caption,
        hashtags,
        captions.first_comment,
        body.duration,
        rawVideoUrl
      ]
    );

    const clipId = (clipRes.rows[0] as { id: string }).id;

    await insertActivityLog(client, {
      userId,
      level: "success",
      category: "caption",
      message: "Run terminé, clip prêt pour review",
      entityId: clipId,
      entityType: "clip"
    });

    await client.query("COMMIT");
    return { success: true, run_id: body.run_id, clip_id: clipId, status: "completed" };
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  }
}
