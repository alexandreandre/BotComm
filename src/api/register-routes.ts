import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { verifySupabaseUserJwt } from "./supabase-auth";
import { env } from "../config/env";
import { AppError } from "../core/errors";
import { withClient } from "../db/pool";
import type { DispatchRunService } from "../services/dispatch-run.service";
import { generateStrategyWithGemini } from "../services/gemini.service";
import type { StorageService } from "../services/storage.service";
import { botWebhookBodySchema, processBotWebhook } from "../services/cinecontent/bot-webhook.service";
import { playGameForUser } from "../services/cinecontent/play-game.service";
import { insertActivityLog } from "./activity-log";

const platformZ = z.enum(["tiktok", "instagram"]);
const captionStyleZ = z.enum([
  "punchy",
  "clean",
  "suspense",
  "quiz_challenge",
  "movie_fans",
  "beat_this"
]);

const strategyCreateSchema = z.object({
  name: z.string().min(1),
  game: z.string().min(1),
  game_url: z.union([z.string().url(), z.literal("")]).optional().default(""),
  theme: z.string().optional().default(""),
  bot_goal: z.string().optional().default(""),
  content_angle: z.string().optional().default(""),
  hook_template: z.string().optional().default(""),
  caption_style: captionStyleZ.default("punchy"),
  platforms: z.array(platformZ).min(1),
  target_clip_duration: z.number().int().positive().max(300).default(20),
  runs_to_launch: z.number().int().positive().max(50).default(3),
  status: z.enum(["draft", "active", "paused", "archived"]).optional().default("draft")
});

const strategyPatchSchema = strategyCreateSchema.partial();

const clipPatchSchema = z.object({
  caption: z.string().optional(),
  hashtags: z.array(z.string()).optional(),
  first_comment: z.string().optional(),
  scheduled_at: z.union([z.string().min(1), z.null()]).optional()
});

const settingsPutSchema = z.record(z.string(), z.string());

const integrationPutSchema = z.object({
  name: z.string().optional(),
  connected: z.boolean().optional(),
  config: z.record(z.string(), z.any()).optional()
});

export type CinecontentRouteDeps = {
  dispatchRunService: DispatchRunService;
  storageService: StorageService;
};

function apiDisabled(reply: { status: (c: number) => { send: (b: unknown) => void } }): void {
  reply.status(503).send({ ok: false, error: "API CineContent désactivée (DATABASE_URL manquant)" });
}

async function requireSupabaseAuth(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const raw = request.headers.authorization;
  if (!raw?.startsWith("Bearer ")) {
    reply.status(401).send({ ok: false, error: "Authorization Bearer requis" });
    return;
  }
  const token = raw.slice("Bearer ".length).trim();
  if (!token) {
    reply.status(401).send({ ok: false, error: "Token manquant" });
    return;
  }
  try {
    request.supabaseUser = await verifySupabaseUserJwt(token);
  } catch {
    reply.status(401).send({ ok: false, error: "Token invalide" });
  }
}

export async function registerCinecontentRoutes(
  app: FastifyInstance,
  deps: CinecontentRouteDeps
): Promise<void> {
  app.post("/api/webhooks/bot", async (request, reply) => {
    if (!env.DATABASE_URL) {
      apiDisabled(reply);
      return;
    }
    const body = botWebhookBodySchema.parse(request.body);
    await withClient(async (client) => {
      const result = await processBotWebhook(body, client, deps.storageService);
      if (!result.success && result.status === "invalid_token") {
        reply.status(401).send({ ok: false, ...result });
        return;
      }
      reply.status(200).send({ ok: true, ...result });
    });
  });

  app.addHook("preHandler", async (request, reply) => {
    const url = request.url.split("?")[0] ?? request.url;
    if (!url.startsWith("/api/")) {
      return;
    }
    if (url === "/api/webhooks/bot") {
      return;
    }
    await requireSupabaseAuth(request, reply);
    if (reply.sent) {
      return;
    }
  });

  app.get("/api/me", async (request, reply) => {
    if (!env.DATABASE_URL) {
      apiDisabled(reply);
      return;
    }
    const uid = request.supabaseUser!.id;
    const email = request.supabaseUser!.email ?? "";
    await withClient(async (client) => {
      await client.query(
        `INSERT INTO profiles (user_id, display_name) VALUES ($1, $2)
         ON CONFLICT (user_id) DO NOTHING`,
        [uid, email]
      );
      const r = await client.query(`SELECT * FROM profiles WHERE user_id = $1`, [uid]);
      reply.send({ ok: true, profile: r.rows[0], email });
    });
  });

  app.patch("/api/me", async (request, reply) => {
    if (!env.DATABASE_URL) {
      apiDisabled(reply);
      return;
    }
    const uid = request.supabaseUser!.id;
    const body = z.object({ display_name: z.string().min(1).max(200).optional() }).parse(request.body);
    await withClient(async (client) => {
      if (body.display_name) {
        await client.query(
          `INSERT INTO profiles (user_id, display_name) VALUES ($1, $2)
           ON CONFLICT (user_id) DO UPDATE SET display_name = EXCLUDED.display_name, updated_at = now()`,
          [uid, body.display_name]
        );
      }
      const r = await client.query(`SELECT * FROM profiles WHERE user_id = $1`, [uid]);
      reply.send({ ok: true, profile: r.rows[0] });
    });
  });

  app.get("/api/strategies", async (request, reply) => {
    if (!env.DATABASE_URL) {
      apiDisabled(reply);
      return;
    }
    const uid = request.supabaseUser!.id;
    await withClient(async (client) => {
      const r = await client.query(
        `SELECT s.*, (SELECT COUNT(*)::int FROM runs r WHERE r.strategy_id = s.id) AS run_count
         FROM content_strategies s WHERE s.user_id = $1 ORDER BY s.updated_at DESC`,
        [uid]
      );
      reply.send({ ok: true, strategies: r.rows });
    });
  });

  app.post("/api/strategies", async (request, reply) => {
    if (!env.DATABASE_URL) {
      apiDisabled(reply);
      return;
    }
    const uid = request.supabaseUser!.id;
    const body = strategyCreateSchema.parse(request.body);
    await withClient(async (client) => {
      const r = await client.query(
        `INSERT INTO content_strategies (
          user_id, name, game, game_url, theme, bot_goal, content_angle, hook_template,
          caption_style, platforms, target_clip_duration, runs_to_launch, status
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8,
          $9::caption_style, $10::platform[], $11, $12, $13::strategy_status
        ) RETURNING *`,
        [
          uid,
          body.name,
          body.game,
          body.game_url,
          body.theme,
          body.bot_goal,
          body.content_angle,
          body.hook_template,
          body.caption_style,
          body.platforms,
          body.target_clip_duration,
          body.runs_to_launch,
          body.status
        ]
      );
      reply.status(201).send({ ok: true, strategy: r.rows[0] });
    });
  });

  app.get("/api/strategies/:id", async (request, reply) => {
    if (!env.DATABASE_URL) {
      apiDisabled(reply);
      return;
    }
    const uid = request.supabaseUser!.id;
    const id = z.string().uuid().parse((request.params as { id: string }).id);
    await withClient(async (client) => {
      const r = await client.query(`SELECT * FROM content_strategies WHERE id = $1 AND user_id = $2`, [
        id,
        uid
      ]);
      if (!r.rowCount) {
        reply.status(404).send({ ok: false, error: "Introuvable" });
        return;
      }
      reply.send({ ok: true, strategy: r.rows[0] });
    });
  });

  app.patch("/api/strategies/:id", async (request, reply) => {
    if (!env.DATABASE_URL) {
      apiDisabled(reply);
      return;
    }
    const uid = request.supabaseUser!.id;
    const id = z.string().uuid().parse((request.params as { id: string }).id);
    const body = strategyPatchSchema.parse(request.body);
    const fields: string[] = [];
    const values: unknown[] = [];
    let i = 1;
    if (body.name !== undefined) {
      fields.push(`name = $${i}`);
      values.push(body.name);
      i += 1;
    }
    if (body.game !== undefined) {
      fields.push(`game = $${i}`);
      values.push(body.game);
      i += 1;
    }
    if (body.game_url !== undefined) {
      fields.push(`game_url = $${i}`);
      values.push(body.game_url);
      i += 1;
    }
    if (body.theme !== undefined) {
      fields.push(`theme = $${i}`);
      values.push(body.theme);
      i += 1;
    }
    if (body.bot_goal !== undefined) {
      fields.push(`bot_goal = $${i}`);
      values.push(body.bot_goal);
      i += 1;
    }
    if (body.content_angle !== undefined) {
      fields.push(`content_angle = $${i}`);
      values.push(body.content_angle);
      i += 1;
    }
    if (body.hook_template !== undefined) {
      fields.push(`hook_template = $${i}`);
      values.push(body.hook_template);
      i += 1;
    }
    if (body.caption_style !== undefined) {
      fields.push(`caption_style = $${i}::caption_style`);
      values.push(body.caption_style);
      i += 1;
    }
    if (body.platforms !== undefined) {
      fields.push(`platforms = $${i}::platform[]`);
      values.push(body.platforms);
      i += 1;
    }
    if (body.target_clip_duration !== undefined) {
      fields.push(`target_clip_duration = $${i}`);
      values.push(body.target_clip_duration);
      i += 1;
    }
    if (body.runs_to_launch !== undefined) {
      fields.push(`runs_to_launch = $${i}`);
      values.push(body.runs_to_launch);
      i += 1;
    }
    if (body.status !== undefined) {
      fields.push(`status = $${i}::strategy_status`);
      values.push(body.status);
      i += 1;
    }
    if (fields.length === 0) {
      reply.status(400).send({ ok: false, error: "Aucun champ à mettre à jour" });
      return;
    }
    values.push(id, uid);
    await withClient(async (client) => {
      const r = await client.query(
        `UPDATE content_strategies SET ${fields.join(", ")}, updated_at = now()
         WHERE id = $${i} AND user_id = $${i + 1} RETURNING *`,
        values
      );
      if (!r.rowCount) {
        reply.status(404).send({ ok: false, error: "Introuvable" });
        return;
      }
      reply.send({ ok: true, strategy: r.rows[0] });
    });
  });

  app.delete("/api/strategies/:id", async (request, reply) => {
    if (!env.DATABASE_URL) {
      apiDisabled(reply);
      return;
    }
    const uid = request.supabaseUser!.id;
    const id = z.string().uuid().parse((request.params as { id: string }).id);
    await withClient(async (client) => {
      const r = await client.query(`DELETE FROM content_strategies WHERE id = $1 AND user_id = $2`, [id, uid]);
      if (!r.rowCount) {
        reply.status(404).send({ ok: false, error: "Introuvable" });
        return;
      }
      reply.send({ ok: true });
    });
  });

  app.post("/api/runs/play", async (request, reply) => {
    if (!env.DATABASE_URL) {
      apiDisabled(reply);
      return;
    }
    const uid = request.supabaseUser!.id;
    const body = z.object({ strategy_id: z.string().uuid() }).parse(request.body);
    await withClient(async (client) => {
      try {
        const out = await playGameForUser(client, uid, body.strategy_id, deps.dispatchRunService, deps.storageService);
        reply.send({ ok: true, ...out });
      } catch (e) {
        if (e instanceof AppError) {
          reply.status(e.statusCode).send({ ok: false, error: e.message, code: e.code });
          return;
        }
        throw e;
      }
    });
  });

  app.get("/api/runs", async (request, reply) => {
    if (!env.DATABASE_URL) {
      apiDisabled(reply);
      return;
    }
    const uid = request.supabaseUser!.id;
    await withClient(async (client) => {
      const r = await client.query(
        `SELECT r.*, s.name AS strategy_name
         FROM runs r
         JOIN content_strategies s ON s.id = r.strategy_id
         WHERE r.user_id = $1
         ORDER BY r.created_at DESC
         LIMIT 200`,
        [uid]
      );
      reply.send({ ok: true, runs: r.rows });
    });
  });

  app.get("/api/runs/:id", async (request, reply) => {
    if (!env.DATABASE_URL) {
      apiDisabled(reply);
      return;
    }
    const uid = request.supabaseUser!.id;
    const id = z.string().uuid().parse((request.params as { id: string }).id);
    await withClient(async (client) => {
      const r = await client.query(
        `SELECT r.*, s.name AS strategy_name FROM runs r
         JOIN content_strategies s ON s.id = r.strategy_id
         WHERE r.id = $1 AND r.user_id = $2`,
        [id, uid]
      );
      if (!r.rowCount) {
        reply.status(404).send({ ok: false, error: "Introuvable" });
        return;
      }
      reply.send({ ok: true, run: r.rows[0] });
    });
  });

  app.get("/api/runs/:id/events", async (request, reply) => {
    if (!env.DATABASE_URL) {
      apiDisabled(reply);
      return;
    }
    const uid = request.supabaseUser!.id;
    const id = z.string().uuid().parse((request.params as { id: string }).id);
    await withClient(async (client) => {
      const check = await client.query(`SELECT 1 FROM runs WHERE id = $1 AND user_id = $2`, [id, uid]);
      if (!check.rowCount) {
        reply.status(404).send({ ok: false, error: "Introuvable" });
        return;
      }
      const r = await client.query(
        `SELECT * FROM run_events WHERE run_id = $1 ORDER BY "timestamp" ASC`,
        [id]
      );
      reply.send({ ok: true, events: r.rows });
    });
  });

  app.get("/api/clips", async (request, reply) => {
    if (!env.DATABASE_URL) {
      apiDisabled(reply);
      return;
    }
    const uid = request.supabaseUser!.id;
    await withClient(async (client) => {
      const r = await client.query(
        `SELECT * FROM clips WHERE user_id = $1 ORDER BY created_at DESC LIMIT 200`,
        [uid]
      );
      reply.send({ ok: true, clips: r.rows });
    });
  });

  app.get("/api/clips/review-queue", async (request, reply) => {
    if (!env.DATABASE_URL) {
      apiDisabled(reply);
      return;
    }
    const uid = request.supabaseUser!.id;
    await withClient(async (client) => {
      const r = await client.query(
        `SELECT * FROM clips WHERE user_id = $1 AND status = 'ready_for_approval'::clip_status
         ORDER BY created_at DESC`,
        [uid]
      );
      reply.send({ ok: true, clips: r.rows });
    });
  });

  app.get("/api/clips/:id", async (request, reply) => {
    if (!env.DATABASE_URL) {
      apiDisabled(reply);
      return;
    }
    const uid = request.supabaseUser!.id;
    const id = z.string().uuid().parse((request.params as { id: string }).id);
    await withClient(async (client) => {
      const r = await client.query(`SELECT * FROM clips WHERE id = $1 AND user_id = $2`, [id, uid]);
      if (!r.rowCount) {
        reply.status(404).send({ ok: false, error: "Introuvable" });
        return;
      }
      reply.send({ ok: true, clip: r.rows[0] });
    });
  });

  app.patch("/api/clips/:id", async (request, reply) => {
    if (!env.DATABASE_URL) {
      apiDisabled(reply);
      return;
    }
    const uid = request.supabaseUser!.id;
    const id = z.string().uuid().parse((request.params as { id: string }).id);
    const body = clipPatchSchema.parse(request.body);
    const fields: string[] = [];
    const values: unknown[] = [];
    let i = 1;
    if (body.caption !== undefined) {
      fields.push(`caption = $${i}`);
      values.push(body.caption);
      i += 1;
    }
    if (body.hashtags !== undefined) {
      fields.push(`hashtags = $${i}::text[]`);
      values.push(body.hashtags);
      i += 1;
    }
    if (body.first_comment !== undefined) {
      fields.push(`first_comment = $${i}`);
      values.push(body.first_comment);
      i += 1;
    }
    if (body.scheduled_at !== undefined) {
      fields.push(`scheduled_at = $${i}::timestamptz`);
      values.push(body.scheduled_at);
      i += 1;
    }
    if (fields.length === 0) {
      reply.status(400).send({ ok: false, error: "Aucun champ" });
      return;
    }
    values.push(id, uid);
    await withClient(async (client) => {
      const r = await client.query(
        `UPDATE clips SET ${fields.join(", ")}, updated_at = now()
         WHERE id = $${i} AND user_id = $${i + 1} RETURNING *`,
        values
      );
      if (!r.rowCount) {
        reply.status(404).send({ ok: false, error: "Introuvable" });
        return;
      }
      reply.send({ ok: true, clip: r.rows[0] });
    });
  });

  app.post("/api/clips/:id/approve", async (request, reply) => {
    if (!env.DATABASE_URL) {
      apiDisabled(reply);
      return;
    }
    const uid = request.supabaseUser!.id;
    const id = z.string().uuid().parse((request.params as { id: string }).id);
    await withClient(async (client) => {
      await client.query("BEGIN");
      try {
        const c = await client.query(
          `SELECT * FROM clips WHERE id = $1 AND user_id = $2 FOR UPDATE`,
          [id, uid]
        );
        if (!c.rowCount) {
          await client.query("ROLLBACK");
          reply.status(404).send({ ok: false, error: "Introuvable" });
          return;
        }
        const clip = c.rows[0] as Record<string, unknown>;
        if (clip["status"] !== "ready_for_approval") {
          await client.query("ROLLBACK");
          reply.status(400).send({ ok: false, error: "Statut clip invalide" });
          return;
        }
        await client.query(
          `UPDATE clips SET status = 'approved'::clip_status, updated_at = now() WHERE id = $1`,
          [id]
        );
        const pj = await client.query(
          `INSERT INTO publish_jobs (user_id, clip_id, platform, status)
           VALUES ($1, $2, $3::platform, 'pending'::publish_status) RETURNING *`,
          [uid, id, clip["platform"]]
        );
        await insertActivityLog(client, {
          userId: uid,
          level: "success",
          category: "approval",
          message: "Clip approuvé",
          entityId: id,
          entityType: "clip"
        });
        await client.query("COMMIT");
        reply.send({ ok: true, clip: { ...clip, status: "approved" }, publish_job: pj.rows[0] });
      } catch (e) {
        await client.query("ROLLBACK");
        throw e;
      }
    });
  });

  app.post("/api/clips/:id/reject", async (request, reply) => {
    if (!env.DATABASE_URL) {
      apiDisabled(reply);
      return;
    }
    const uid = request.supabaseUser!.id;
    const id = z.string().uuid().parse((request.params as { id: string }).id);
    await withClient(async (client) => {
      const r = await client.query(
        `UPDATE clips SET status = 'rejected'::clip_status, updated_at = now()
         WHERE id = $1 AND user_id = $2 AND status = 'ready_for_approval'::clip_status
         RETURNING *`,
        [id, uid]
      );
      if (!r.rowCount) {
        reply.status(400).send({ ok: false, error: "Rejet impossible" });
        return;
      }
      await insertActivityLog(client, {
        userId: uid,
        level: "info",
        category: "approval",
        message: "Clip rejeté",
        entityId: id,
        entityType: "clip"
      });
      reply.send({ ok: true, clip: r.rows[0] });
    });
  });

  app.post("/api/clips/:id/render", async (request, reply) => {
    if (!env.DATABASE_URL) {
      apiDisabled(reply);
      return;
    }
    const uid = request.supabaseUser!.id;
    const id = z.string().uuid().parse((request.params as { id: string }).id);
    await withClient(async (client) => {
      const c = await client.query(
        `SELECT c.*, r.raw_video_url FROM clips c JOIN runs r ON r.id = c.run_id
         WHERE c.id = $1 AND c.user_id = $2`,
        [id, uid]
      );
      if (!c.rowCount) {
        reply.status(404).send({ ok: false, error: "Introuvable" });
        return;
      }
      const row = c.rows[0] as Record<string, unknown>;
      await client.query(
        `UPDATE clips SET status = 'rendering'::clip_status, updated_at = now() WHERE id = $1`,
        [id]
      );
      const raw = row["raw_video_url"] as string | null;
      await client.query(
        `UPDATE clips SET status = 'rendered'::clip_status, video_url = COALESCE(video_url, $2), updated_at = now() WHERE id = $1`,
        [id, raw]
      );
      const out = await client.query(`SELECT * FROM clips WHERE id = $1`, [id]);
      reply.send({ ok: true, clip: out.rows[0], message: "Placeholder: copie vidéo brute" });
    });
  });

  app.get("/api/publish-jobs", async (request, reply) => {
    if (!env.DATABASE_URL) {
      apiDisabled(reply);
      return;
    }
    const uid = request.supabaseUser!.id;
    const q = request.query as { clip_id?: string };
    const clipId = q.clip_id ? z.string().uuid().parse(q.clip_id) : undefined;
    await withClient(async (client) => {
      const r = clipId
        ? await client.query(
            `SELECT * FROM publish_jobs WHERE user_id = $1 AND clip_id = $2 ORDER BY created_at DESC`,
            [uid, clipId]
          )
        : await client.query(
            `SELECT * FROM publish_jobs WHERE user_id = $1 ORDER BY created_at DESC LIMIT 200`,
            [uid]
          );
      reply.send({ ok: true, jobs: r.rows });
    });
  });

  app.post("/api/publish-jobs/:id/publish", async (request, reply) => {
    if (!env.DATABASE_URL) {
      apiDisabled(reply);
      return;
    }
    const uid = request.supabaseUser!.id;
    const id = z.string().uuid().parse((request.params as { id: string }).id);
    await withClient(async (client) => {
      const pj = await client.query(
        `SELECT pj.*, c.caption, c.game, s.name AS strategy_name
         FROM publish_jobs pj
         JOIN clips c ON c.id = pj.clip_id
         JOIN content_strategies s ON s.id = c.strategy_id
         WHERE pj.id = $1 AND pj.user_id = $2`,
        [id, uid]
      );
      if (!pj.rowCount) {
        reply.status(404).send({ ok: false, error: "Introuvable" });
        return;
      }
      const job = pj.rows[0] as Record<string, unknown>;
      const st = job["status"] as string;
      if (st !== "pending" && st !== "retry") {
        reply.status(400).send({ ok: false, error: "Job non publiable" });
        return;
      }
      const clipId = job["clip_id"] as string;
      const clipCheck = await client.query(`SELECT status FROM clips WHERE id = $1`, [clipId]);
      const clipStatus = (clipCheck.rows[0] as { status: string } | undefined)?.status;
      if (clipStatus !== "approved") {
        reply.status(400).send({ ok: false, error: "Clip non approuvé" });
        return;
      }

      await client.query(
        `UPDATE publish_jobs SET status = 'publishing'::publish_status, updated_at = now() WHERE id = $1`,
        [id]
      );

      const fakeId = `sim_${id.slice(0, 8)}`;
      await client.query(
        `UPDATE publish_jobs SET
          status = 'published'::publish_status,
          external_post_id = $2,
          published_at = now(),
          updated_at = now()
         WHERE id = $1`,
        [id, fakeId]
      );

      const pp = await client.query(
        `INSERT INTO published_posts (
          user_id, publish_job_id, clip_id, platform, external_post_id, caption, strategy_name, game
        ) VALUES ($1, $2, $3, $4::platform, $5, $6, $7, $8) RETURNING *`,
        [
          uid,
          id,
          clipId,
          job["platform"],
          fakeId,
          job["caption"],
          job["strategy_name"],
          job["game"]
        ]
      );

      await insertActivityLog(client, {
        userId: uid,
        level: "success",
        category: "publish",
        message: "Publication simulée (placeholder)",
        entityId: id,
        entityType: "publish_job"
      });

      reply.send({ ok: true, publish_job: { ...job, status: "published", external_post_id: fakeId }, published_post: pp.rows[0] });
    });
  });

  app.get("/api/published-posts", async (request, reply) => {
    if (!env.DATABASE_URL) {
      apiDisabled(reply);
      return;
    }
    const uid = request.supabaseUser!.id;
    await withClient(async (client) => {
      const r = await client.query(
        `SELECT * FROM published_posts WHERE user_id = $1 ORDER BY published_at DESC LIMIT 500`,
        [uid]
      );
      reply.send({ ok: true, posts: r.rows });
    });
  });

  app.get("/api/activity-logs", async (request, reply) => {
    if (!env.DATABASE_URL) {
      apiDisabled(reply);
      return;
    }
    const uid = request.supabaseUser!.id;
    const q = z
      .object({ category: z.enum(["run", "clip", "caption", "approval", "publish", "system"]).optional() })
      .parse(request.query as Record<string, string>);
    await withClient(async (client) => {
      const r = q.category
        ? await client.query(
            `SELECT * FROM activity_logs WHERE user_id = $1 AND category = $2::log_category
             ORDER BY created_at DESC LIMIT 300`,
            [uid, q.category]
          )
        : await client.query(
            `SELECT * FROM activity_logs WHERE user_id = $1 ORDER BY created_at DESC LIMIT 300`,
            [uid]
          );
      reply.send({ ok: true, logs: r.rows });
    });
  });

  app.get("/api/settings", async (request, reply) => {
    if (!env.DATABASE_URL) {
      apiDisabled(reply);
      return;
    }
    const uid = request.supabaseUser!.id;
    await withClient(async (client) => {
      const r = await client.query(`SELECT key, value FROM app_settings WHERE user_id = $1`, [uid]);
      const map: Record<string, string> = {};
      for (const row of r.rows as { key: string; value: string }[]) {
        map[row.key] = row.value;
      }
      reply.send({ ok: true, settings: map });
    });
  });

  app.put("/api/settings", async (request, reply) => {
    if (!env.DATABASE_URL) {
      apiDisabled(reply);
      return;
    }
    const uid = request.supabaseUser!.id;
    const body = settingsPutSchema.parse(request.body);
    await withClient(async (client) => {
      for (const [key, value] of Object.entries(body)) {
        await client.query(
          `INSERT INTO app_settings (user_id, key, value) VALUES ($1, $2, $3)
           ON CONFLICT (user_id, key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
          [uid, key, value]
        );
      }
      reply.send({ ok: true });
    });
  });

  app.get("/api/integrations", async (request, reply) => {
    if (!env.DATABASE_URL) {
      apiDisabled(reply);
      return;
    }
    const uid = request.supabaseUser!.id;
    await withClient(async (client) => {
      const r = await client.query(`SELECT * FROM integrations WHERE user_id = $1`, [uid]);
      reply.send({ ok: true, integrations: r.rows });
    });
  });

  app.put("/api/integrations/:platform", async (request, reply) => {
    if (!env.DATABASE_URL) {
      apiDisabled(reply);
      return;
    }
    const uid = request.supabaseUser!.id;
    const platform = z.string().min(1).max(64).parse((request.params as { platform: string }).platform);
    const body = integrationPutSchema.parse(request.body);
    await withClient(async (client) => {
      const name = body.name ?? platform;
      const connected = body.connected ?? false;
      const config = body.config ?? {};
      const cfg = JSON.stringify(config);
      const upd = await client.query(
        `UPDATE integrations SET name = $3, connected = $4, config = $5::jsonb, updated_at = now()
         WHERE user_id = $1::uuid AND platform = $2
         RETURNING *`,
        [uid, platform, name, connected, cfg]
      );
      if (upd.rowCount) {
        reply.send({ ok: true, integration: upd.rows[0] });
        return;
      }
      const ins = await client.query(
        `INSERT INTO integrations (user_id, platform, name, connected, config)
         VALUES ($1::uuid, $2, $3, $4, $5::jsonb)
         RETURNING *`,
        [uid, platform, name, connected, cfg]
      );
      reply.send({ ok: true, integration: ins.rows[0] });
    });
  });

  app.post("/api/ai/generate-strategy", async (request, reply) => {
    if (!env.DATABASE_URL) {
      apiDisabled(reply);
      return;
    }
    const body = z.object({ game: z.string().min(1).max(200) }).parse(request.body);
    const strategy = await generateStrategyWithGemini(body.game);
    reply.send({ ok: true, strategy });
  });

  app.get("/api/dashboard/summary", async (request, reply) => {
    if (!env.DATABASE_URL) {
      apiDisabled(reply);
      return;
    }
    const uid = request.supabaseUser!.id;
    await withClient(async (client) => {
      const todayRuns = await client.query(
        `SELECT COUNT(*)::int AS c FROM runs WHERE user_id = $1 AND created_at::date = CURRENT_DATE`,
        [uid]
      );
      const totalRuns = await client.query(`SELECT COUNT(*)::int AS c FROM runs WHERE user_id = $1`, [uid]);
      const clipsReady = await client.query(
        `SELECT COUNT(*)::int AS c FROM clips WHERE user_id = $1 AND status = 'ready_for_approval'::clip_status`,
        [uid]
      );
      const pendingPublish = await client.query(
        `SELECT COUNT(*)::int AS c FROM publish_jobs WHERE user_id = $1 AND status IN ('pending','retry')`,
        [uid]
      );
      const published = await client.query(
        `SELECT COUNT(*)::int AS c FROM published_posts WHERE user_id = $1`,
        [uid]
      );
      const errors = await client.query(
        `SELECT COUNT(*)::int AS c FROM activity_logs WHERE user_id = $1 AND level = 'error'::log_level
         AND created_at > now() - interval '7 days'`,
        [uid]
      );
      const chart = await client.query(
        `SELECT (published_at::date)::text AS day, COALESCE(SUM(views),0)::int AS views
         FROM published_posts
         WHERE user_id = $1 AND published_at > now() - interval '7 days'
         GROUP BY published_at::date
         ORDER BY day ASC`,
        [uid]
      );
      const review = await client.query(
        `SELECT * FROM clips WHERE user_id = $1 AND status = 'ready_for_approval'::clip_status
         ORDER BY created_at DESC LIMIT 3`,
        [uid]
      );
      const logs = await client.query(
        `SELECT * FROM activity_logs WHERE user_id = $1 ORDER BY created_at DESC LIMIT 5`,
        [uid]
      );
      reply.send({
        ok: true,
        kpis: {
          runs_today: todayRuns.rows[0]?.c ?? 0,
          total_runs: totalRuns.rows[0]?.c ?? 0,
          clips_ready: clipsReady.rows[0]?.c ?? 0,
          pending_publish: pendingPublish.rows[0]?.c ?? 0,
          published: published.rows[0]?.c ?? 0,
          errors_week: errors.rows[0]?.c ?? 0
        },
        chart: chart.rows,
        review_clips: review.rows,
        recent_logs: logs.rows
      });
    });
  });
}
