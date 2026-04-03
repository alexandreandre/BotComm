import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { getSupabaseAdmin, verifySupabaseUserJwt } from "./supabase-auth";
import { env } from "../config/env";
import { AppError } from "../core/errors";
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

function apiDataReady(): boolean {
  return Boolean(env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY);
}

function apiDisabled(reply: { status: (c: number) => { send: (b: unknown) => void } }): void {
  reply
    .status(503)
    .send({ ok: false, error: "API CineContent désactivée (SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY manquant)" });
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
    if (!apiDataReady()) {
      apiDisabled(reply);
      return;
    }
    const body = botWebhookBodySchema.parse(request.body);
    const result = await processBotWebhook(body, deps.storageService);
    if (!result.success && result.status === "invalid_token") {
      reply.status(401).send({ ok: false, ...result });
      return;
    }
    reply.status(200).send({ ok: true, ...result });
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
    if (!apiDataReady()) {
      apiDisabled(reply);
      return;
    }
    const uid = request.supabaseUser!.id;
    const email = request.supabaseUser!.email ?? "";
    const sb = getSupabaseAdmin();
    const { data: existing } = await sb.from("profiles").select("id").eq("user_id", uid).maybeSingle();
    if (!existing) {
      const { error: insErr } = await sb.from("profiles").insert({ user_id: uid, display_name: email });
      if (insErr && !String(insErr.message).includes("duplicate")) {
        throw insErr;
      }
    }
    const { data: profile, error } = await sb.from("profiles").select("*").eq("user_id", uid).maybeSingle();
    if (error) {
      throw error;
    }
    reply.send({ ok: true, profile, email });
  });

  app.patch("/api/me", async (request, reply) => {
    if (!apiDataReady()) {
      apiDisabled(reply);
      return;
    }
    const uid = request.supabaseUser!.id;
    const body = z.object({ display_name: z.string().min(1).max(200).optional() }).parse(request.body);
    const sb = getSupabaseAdmin();
    if (body.display_name) {
      const { error: upErr } = await sb.from("profiles").upsert(
        { user_id: uid, display_name: body.display_name },
        { onConflict: "user_id" }
      );
      if (upErr) {
        throw upErr;
      }
    }
    const { data: profile, error } = await sb.from("profiles").select("*").eq("user_id", uid).maybeSingle();
    if (error) {
      throw error;
    }
    reply.send({ ok: true, profile });
  });

  app.get("/api/strategies", async (request, reply) => {
    if (!apiDataReady()) {
      apiDisabled(reply);
      return;
    }
    const uid = request.supabaseUser!.id;
    const sb = getSupabaseAdmin();
    const { data: strategies, error: e1 } = await sb
      .from("content_strategies")
      .select("*")
      .eq("user_id", uid)
      .order("updated_at", { ascending: false });
    if (e1) {
      throw e1;
    }
    const { data: runs, error: e2 } = await sb.from("runs").select("strategy_id").eq("user_id", uid);
    if (e2) {
      throw e2;
    }
    const counts = new Map<string, number>();
    for (const r of runs ?? []) {
      const sid = r.strategy_id as string;
      counts.set(sid, (counts.get(sid) ?? 0) + 1);
    }
    const rows = (strategies ?? []).map((s) => ({
      ...s,
      run_count: counts.get(s.id as string) ?? 0
    }));
    reply.send({ ok: true, strategies: rows });
  });

  app.post("/api/strategies", async (request, reply) => {
    if (!apiDataReady()) {
      apiDisabled(reply);
      return;
    }
    const uid = request.supabaseUser!.id;
    const body = strategyCreateSchema.parse(request.body);
    const sb = getSupabaseAdmin();
    const { data: row, error } = await sb
      .from("content_strategies")
      .insert({
        user_id: uid,
        name: body.name,
        game: body.game,
        game_url: body.game_url,
        theme: body.theme,
        bot_goal: body.bot_goal,
        content_angle: body.content_angle,
        hook_template: body.hook_template,
        caption_style: body.caption_style,
        platforms: body.platforms,
        target_clip_duration: body.target_clip_duration,
        runs_to_launch: body.runs_to_launch,
        status: body.status
      })
      .select()
      .single();
    if (error) {
      throw error;
    }
    reply.status(201).send({ ok: true, strategy: row });
  });

  app.get("/api/strategies/:id", async (request, reply) => {
    if (!apiDataReady()) {
      apiDisabled(reply);
      return;
    }
    const uid = request.supabaseUser!.id;
    const id = z.string().uuid().parse((request.params as { id: string }).id);
    const sb = getSupabaseAdmin();
    const { data: row, error } = await sb
      .from("content_strategies")
      .select("*")
      .eq("id", id)
      .eq("user_id", uid)
      .maybeSingle();
    if (error) {
      throw error;
    }
    if (!row) {
      reply.status(404).send({ ok: false, error: "Introuvable" });
      return;
    }
    reply.send({ ok: true, strategy: row });
  });

  app.patch("/api/strategies/:id", async (request, reply) => {
    if (!apiDataReady()) {
      apiDisabled(reply);
      return;
    }
    const uid = request.supabaseUser!.id;
    const id = z.string().uuid().parse((request.params as { id: string }).id);
    const body = strategyPatchSchema.parse(request.body);
    const patch: Record<string, unknown> = {};
    if (body.name !== undefined) patch.name = body.name;
    if (body.game !== undefined) patch.game = body.game;
    if (body.game_url !== undefined) patch.game_url = body.game_url;
    if (body.theme !== undefined) patch.theme = body.theme;
    if (body.bot_goal !== undefined) patch.bot_goal = body.bot_goal;
    if (body.content_angle !== undefined) patch.content_angle = body.content_angle;
    if (body.hook_template !== undefined) patch.hook_template = body.hook_template;
    if (body.caption_style !== undefined) patch.caption_style = body.caption_style;
    if (body.platforms !== undefined) patch.platforms = body.platforms;
    if (body.target_clip_duration !== undefined) patch.target_clip_duration = body.target_clip_duration;
    if (body.runs_to_launch !== undefined) patch.runs_to_launch = body.runs_to_launch;
    if (body.status !== undefined) patch.status = body.status;
    if (Object.keys(patch).length === 0) {
      reply.status(400).send({ ok: false, error: "Aucun champ à mettre à jour" });
      return;
    }
    const sb = getSupabaseAdmin();
    const { data: row, error } = await sb
      .from("content_strategies")
      .update(patch)
      .eq("id", id)
      .eq("user_id", uid)
      .select()
      .maybeSingle();
    if (error) {
      throw error;
    }
    if (!row) {
      reply.status(404).send({ ok: false, error: "Introuvable" });
      return;
    }
    reply.send({ ok: true, strategy: row });
  });

  app.delete("/api/strategies/:id", async (request, reply) => {
    if (!apiDataReady()) {
      apiDisabled(reply);
      return;
    }
    const uid = request.supabaseUser!.id;
    const id = z.string().uuid().parse((request.params as { id: string }).id);
    const sb = getSupabaseAdmin();
    const { data: delRows, error } = await sb
      .from("content_strategies")
      .delete()
      .eq("id", id)
      .eq("user_id", uid)
      .select("id");
    if (error) {
      throw error;
    }
    if (!delRows?.length) {
      reply.status(404).send({ ok: false, error: "Introuvable" });
      return;
    }
    reply.send({ ok: true });
  });

  app.post("/api/runs/play", async (request, reply) => {
    if (!apiDataReady()) {
      apiDisabled(reply);
      return;
    }
    const uid = request.supabaseUser!.id;
    const body = z.object({ strategy_id: z.string().uuid() }).parse(request.body);
    try {
      const out = await playGameForUser(uid, body.strategy_id, deps.dispatchRunService, deps.storageService);
      reply.send({ ok: true, ...out });
    } catch (e) {
      if (e instanceof AppError) {
        reply.status(e.statusCode).send({ ok: false, error: e.message, code: e.code });
        return;
      }
      throw e;
    }
  });

  app.get("/api/runs", async (request, reply) => {
    if (!apiDataReady()) {
      apiDisabled(reply);
      return;
    }
    const uid = request.supabaseUser!.id;
    const sb = getSupabaseAdmin();
    const { data: rows, error } = await sb
      .from("runs")
      .select("*, content_strategies(name)")
      .eq("user_id", uid)
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) {
      throw error;
    }
    const runs = (rows ?? []).map((r) => {
      const cs = r.content_strategies as { name: string } | null;
      const { content_strategies: _c, ...rest } = r as Record<string, unknown>;
      return { ...rest, strategy_name: cs?.name ?? null };
    });
    reply.send({ ok: true, runs });
  });

  app.get("/api/runs/:id", async (request, reply) => {
    if (!apiDataReady()) {
      apiDisabled(reply);
      return;
    }
    const uid = request.supabaseUser!.id;
    const id = z.string().uuid().parse((request.params as { id: string }).id);
    const sb = getSupabaseAdmin();
    const { data: row, error } = await sb
      .from("runs")
      .select("*, content_strategies(name)")
      .eq("id", id)
      .eq("user_id", uid)
      .maybeSingle();
    if (error) {
      throw error;
    }
    if (!row) {
      reply.status(404).send({ ok: false, error: "Introuvable" });
      return;
    }
    const cs = row.content_strategies as { name: string } | null;
    const { content_strategies: _c, ...rest } = row as Record<string, unknown>;
    reply.send({ ok: true, run: { ...rest, strategy_name: cs?.name ?? null } });
  });

  app.get("/api/runs/:id/events", async (request, reply) => {
    if (!apiDataReady()) {
      apiDisabled(reply);
      return;
    }
    const uid = request.supabaseUser!.id;
    const id = z.string().uuid().parse((request.params as { id: string }).id);
    const sb = getSupabaseAdmin();
    const { data: check, error: e1 } = await sb.from("runs").select("id").eq("id", id).eq("user_id", uid).maybeSingle();
    if (e1) {
      throw e1;
    }
    if (!check) {
      reply.status(404).send({ ok: false, error: "Introuvable" });
      return;
    }
    const { data: events, error: e2 } = await sb
      .from("run_events")
      .select("*")
      .eq("run_id", id)
      .order("timestamp", { ascending: true });
    if (e2) {
      throw e2;
    }
    reply.send({ ok: true, events: events ?? [] });
  });

  app.get("/api/clips", async (request, reply) => {
    if (!apiDataReady()) {
      apiDisabled(reply);
      return;
    }
    const uid = request.supabaseUser!.id;
    const sb = getSupabaseAdmin();
    const { data: rows, error } = await sb
      .from("clips")
      .select("*")
      .eq("user_id", uid)
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) {
      throw error;
    }
    reply.send({ ok: true, clips: rows ?? [] });
  });

  app.get("/api/clips/review-queue", async (request, reply) => {
    if (!apiDataReady()) {
      apiDisabled(reply);
      return;
    }
    const uid = request.supabaseUser!.id;
    const sb = getSupabaseAdmin();
    const { data: rows, error } = await sb
      .from("clips")
      .select("*")
      .eq("user_id", uid)
      .eq("status", "ready_for_approval")
      .order("created_at", { ascending: false });
    if (error) {
      throw error;
    }
    reply.send({ ok: true, clips: rows ?? [] });
  });

  app.get("/api/clips/:id", async (request, reply) => {
    if (!apiDataReady()) {
      apiDisabled(reply);
      return;
    }
    const uid = request.supabaseUser!.id;
    const id = z.string().uuid().parse((request.params as { id: string }).id);
    const sb = getSupabaseAdmin();
    const { data: row, error } = await sb.from("clips").select("*").eq("id", id).eq("user_id", uid).maybeSingle();
    if (error) {
      throw error;
    }
    if (!row) {
      reply.status(404).send({ ok: false, error: "Introuvable" });
      return;
    }
    reply.send({ ok: true, clip: row });
  });

  app.patch("/api/clips/:id", async (request, reply) => {
    if (!apiDataReady()) {
      apiDisabled(reply);
      return;
    }
    const uid = request.supabaseUser!.id;
    const id = z.string().uuid().parse((request.params as { id: string }).id);
    const body = clipPatchSchema.parse(request.body);
    const patch: Record<string, unknown> = {};
    if (body.caption !== undefined) patch.caption = body.caption;
    if (body.hashtags !== undefined) patch.hashtags = body.hashtags;
    if (body.first_comment !== undefined) patch.first_comment = body.first_comment;
    if (body.scheduled_at !== undefined) patch.scheduled_at = body.scheduled_at;
    if (Object.keys(patch).length === 0) {
      reply.status(400).send({ ok: false, error: "Aucun champ" });
      return;
    }
    const sb = getSupabaseAdmin();
    const { data: row, error } = await sb
      .from("clips")
      .update(patch)
      .eq("id", id)
      .eq("user_id", uid)
      .select()
      .maybeSingle();
    if (error) {
      throw error;
    }
    if (!row) {
      reply.status(404).send({ ok: false, error: "Introuvable" });
      return;
    }
    reply.send({ ok: true, clip: row });
  });

  app.post("/api/clips/:id/approve", async (request, reply) => {
    if (!apiDataReady()) {
      apiDisabled(reply);
      return;
    }
    const uid = request.supabaseUser!.id;
    const id = z.string().uuid().parse((request.params as { id: string }).id);
    const sb = getSupabaseAdmin();
    const { data: clip, error: e1 } = await sb.from("clips").select("*").eq("id", id).eq("user_id", uid).maybeSingle();
    if (e1) {
      throw e1;
    }
    if (!clip) {
      reply.status(404).send({ ok: false, error: "Introuvable" });
      return;
    }
    if (clip.status !== "ready_for_approval") {
      reply.status(400).send({ ok: false, error: "Statut clip invalide" });
      return;
    }
    const { error: e2 } = await sb.from("clips").update({ status: "approved" }).eq("id", id);
    if (e2) {
      throw e2;
    }
    const { data: pj, error: e3 } = await sb
      .from("publish_jobs")
      .insert({
        user_id: uid,
        clip_id: id,
        platform: clip.platform as string,
        status: "pending"
      })
      .select()
      .single();
    if (e3 || !pj) {
      throw e3 ?? new Error("publish_jobs insert failed");
    }
    await insertActivityLog({
      userId: uid,
      level: "success",
      category: "approval",
      message: "Clip approuvé",
      entityId: id,
      entityType: "clip"
    });
    reply.send({ ok: true, clip: { ...clip, status: "approved" }, publish_job: pj });
  });

  app.post("/api/clips/:id/reject", async (request, reply) => {
    if (!apiDataReady()) {
      apiDisabled(reply);
      return;
    }
    const uid = request.supabaseUser!.id;
    const id = z.string().uuid().parse((request.params as { id: string }).id);
    const sb = getSupabaseAdmin();
    const { data: row, error } = await sb
      .from("clips")
      .update({ status: "rejected" })
      .eq("id", id)
      .eq("user_id", uid)
      .eq("status", "ready_for_approval")
      .select()
      .maybeSingle();
    if (error) {
      throw error;
    }
    if (!row) {
      reply.status(400).send({ ok: false, error: "Rejet impossible" });
      return;
    }
    await insertActivityLog({
      userId: uid,
      level: "info",
      category: "approval",
      message: "Clip rejeté",
      entityId: id,
      entityType: "clip"
    });
    reply.send({ ok: true, clip: row });
  });

  app.post("/api/clips/:id/render", async (request, reply) => {
    if (!apiDataReady()) {
      apiDisabled(reply);
      return;
    }
    const uid = request.supabaseUser!.id;
    const id = z.string().uuid().parse((request.params as { id: string }).id);
    const sb = getSupabaseAdmin();
    const { data: joined, error: e1 } = await sb
      .from("clips")
      .select("*, runs(raw_video_url)")
      .eq("id", id)
      .eq("user_id", uid)
      .maybeSingle();
    if (e1) {
      throw e1;
    }
    if (!joined) {
      reply.status(404).send({ ok: false, error: "Introuvable" });
      return;
    }
    const runsJoin = joined.runs as { raw_video_url: string | null } | null;
    const raw = runsJoin?.raw_video_url ?? null;
    const prevVideo = (joined as { video_url?: string | null }).video_url ?? null;
    const { error: e2 } = await sb.from("clips").update({ status: "rendering" }).eq("id", id);
    if (e2) {
      throw e2;
    }
    const { error: e3 } = await sb
      .from("clips")
      .update({
        status: "rendered",
        video_url: prevVideo ?? raw
      })
      .eq("id", id);
    if (e3) {
      throw e3;
    }
    const { data: clip, error: e4 } = await sb.from("clips").select("*").eq("id", id).single();
    if (e4 || !clip) {
      throw e4 ?? new Error("clip fetch failed");
    }
    reply.send({ ok: true, clip, message: "Placeholder: copie vidéo brute" });
  });

  app.get("/api/publish-jobs", async (request, reply) => {
    if (!apiDataReady()) {
      apiDisabled(reply);
      return;
    }
    const uid = request.supabaseUser!.id;
    const q = request.query as { clip_id?: string };
    const clipId = q.clip_id ? z.string().uuid().parse(q.clip_id) : undefined;
    const sb = getSupabaseAdmin();
    let qb = sb.from("publish_jobs").select("*").eq("user_id", uid).order("created_at", { ascending: false });
    if (clipId) {
      qb = qb.eq("clip_id", clipId);
    } else {
      qb = qb.limit(200);
    }
    const { data: rows, error } = await qb;
    if (error) {
      throw error;
    }
    reply.send({ ok: true, jobs: rows ?? [] });
  });

  app.post("/api/publish-jobs/:id/publish", async (request, reply) => {
    if (!apiDataReady()) {
      apiDisabled(reply);
      return;
    }
    const uid = request.supabaseUser!.id;
    const id = z.string().uuid().parse((request.params as { id: string }).id);
    const sb = getSupabaseAdmin();
    const { data: pjRow, error: e1 } = await sb
      .from("publish_jobs")
      .select(
        `
        *,
        clips (
          caption,
          game,
          status,
          strategy_id,
          content_strategies ( name )
        )
      `
      )
      .eq("id", id)
      .eq("user_id", uid)
      .maybeSingle();
    if (e1) {
      throw e1;
    }
    if (!pjRow) {
      reply.status(404).send({ ok: false, error: "Introuvable" });
      return;
    }
    const job = pjRow as Record<string, unknown>;
    const st = job.status as string;
    if (st !== "pending" && st !== "retry") {
      reply.status(400).send({ ok: false, error: "Job non publiable" });
      return;
    }
    const clipJoin = job.clips as {
      caption: string;
      game: string;
      status: string;
      strategy_id: string;
      content_strategies: { name: string } | null;
    } | null;
    const clipId = job.clip_id as string;
    const clipStatus = clipJoin?.status;
    if (clipStatus !== "approved") {
      reply.status(400).send({ ok: false, error: "Clip non approuvé" });
      return;
    }

    const { error: e2 } = await sb.from("publish_jobs").update({ status: "publishing" }).eq("id", id);
    if (e2) {
      throw e2;
    }

    const fakeId = `sim_${id.slice(0, 8)}`;
    const { error: e3 } = await sb
      .from("publish_jobs")
      .update({
        status: "published",
        external_post_id: fakeId,
        published_at: new Date().toISOString()
      })
      .eq("id", id);
    if (e3) {
      throw e3;
    }

    const strategyName = clipJoin?.content_strategies?.name ?? "";
    const { data: pp, error: e4 } = await sb
      .from("published_posts")
      .insert({
        user_id: uid,
        publish_job_id: id,
        clip_id: clipId,
        platform: job.platform as string,
        external_post_id: fakeId,
        caption: clipJoin?.caption ?? "",
        strategy_name: strategyName,
        game: clipJoin?.game ?? ""
      })
      .select()
      .single();
    if (e4 || !pp) {
      throw e4 ?? new Error("published_posts insert failed");
    }

    await insertActivityLog({
      userId: uid,
      level: "success",
      category: "publish",
      message: "Publication simulée (placeholder)",
      entityId: id,
      entityType: "publish_job"
    });

    reply.send({
      ok: true,
      publish_job: { ...job, status: "published", external_post_id: fakeId },
      published_post: pp
    });
  });

  app.get("/api/published-posts", async (request, reply) => {
    if (!apiDataReady()) {
      apiDisabled(reply);
      return;
    }
    const uid = request.supabaseUser!.id;
    const sb = getSupabaseAdmin();
    const { data: rows, error } = await sb
      .from("published_posts")
      .select("*")
      .eq("user_id", uid)
      .order("published_at", { ascending: false })
      .limit(500);
    if (error) {
      throw error;
    }
    reply.send({ ok: true, posts: rows ?? [] });
  });

  app.get("/api/activity-logs", async (request, reply) => {
    if (!apiDataReady()) {
      apiDisabled(reply);
      return;
    }
    const uid = request.supabaseUser!.id;
    const q = z
      .object({ category: z.enum(["run", "clip", "caption", "approval", "publish", "system"]).optional() })
      .parse(request.query as Record<string, string>);
    const sb = getSupabaseAdmin();
    let qb = sb.from("activity_logs").select("*").eq("user_id", uid).order("created_at", { ascending: false }).limit(300);
    if (q.category) {
      qb = qb.eq("category", q.category);
    }
    const { data: rows, error } = await qb;
    if (error) {
      throw error;
    }
    reply.send({ ok: true, logs: rows ?? [] });
  });

  app.get("/api/settings", async (request, reply) => {
    if (!apiDataReady()) {
      apiDisabled(reply);
      return;
    }
    const uid = request.supabaseUser!.id;
    const sb = getSupabaseAdmin();
    const { data: rows, error } = await sb.from("app_settings").select("key, value").eq("user_id", uid);
    if (error) {
      throw error;
    }
    const map: Record<string, string> = {};
    for (const row of rows ?? []) {
      map[row.key as string] = row.value as string;
    }
    reply.send({ ok: true, settings: map });
  });

  app.put("/api/settings", async (request, reply) => {
    if (!apiDataReady()) {
      apiDisabled(reply);
      return;
    }
    const uid = request.supabaseUser!.id;
    const body = settingsPutSchema.parse(request.body);
    const sb = getSupabaseAdmin();
    for (const [key, value] of Object.entries(body)) {
      const { error } = await sb.from("app_settings").upsert(
        { user_id: uid, key, value },
        { onConflict: "user_id,key" }
      );
      if (error) {
        throw error;
      }
    }
    reply.send({ ok: true });
  });

  app.get("/api/integrations", async (request, reply) => {
    if (!apiDataReady()) {
      apiDisabled(reply);
      return;
    }
    const uid = request.supabaseUser!.id;
    const sb = getSupabaseAdmin();
    const { data: rows, error } = await sb.from("integrations").select("*").eq("user_id", uid);
    if (error) {
      throw error;
    }
    reply.send({ ok: true, integrations: rows ?? [] });
  });

  app.put("/api/integrations/:platform", async (request, reply) => {
    if (!apiDataReady()) {
      apiDisabled(reply);
      return;
    }
    const uid = request.supabaseUser!.id;
    const platform = z.string().min(1).max(64).parse((request.params as { platform: string }).platform);
    const body = integrationPutSchema.parse(request.body);
    const name = body.name ?? platform;
    const connected = body.connected ?? false;
    const config = body.config ?? {};
    const sb = getSupabaseAdmin();
    const { data: upd, error: e1 } = await sb
      .from("integrations")
      .update({
        name,
        connected,
        config
      })
      .eq("user_id", uid)
      .eq("platform", platform)
      .select()
      .maybeSingle();
    if (e1) {
      throw e1;
    }
    if (upd) {
      reply.send({ ok: true, integration: upd });
      return;
    }
    const { data: ins, error: e2 } = await sb
      .from("integrations")
      .insert({
        user_id: uid,
        platform,
        name,
        connected,
        config
      })
      .select()
      .single();
    if (e2 || !ins) {
      throw e2 ?? new Error("integrations insert failed");
    }
    reply.send({ ok: true, integration: ins });
  });

  app.post("/api/ai/generate-strategy", async (request, reply) => {
    if (!apiDataReady()) {
      apiDisabled(reply);
      return;
    }
    const body = z.object({ game: z.string().min(1).max(200) }).parse(request.body);
    const strategy = await generateStrategyWithGemini(body.game);
    reply.send({ ok: true, strategy });
  });

  app.get("/api/dashboard/summary", async (request, reply) => {
    if (!apiDataReady()) {
      apiDisabled(reply);
      return;
    }
    const uid = request.supabaseUser!.id;
    const sb = getSupabaseAdmin();

    const startUtc = new Date();
    startUtc.setUTCHours(0, 0, 0, 0);

    const [{ count: runsToday }, { count: totalRuns }, { count: clipsReady }, { count: pendingPublish }, { count: published }, { count: errorsWeek }, { data: postsWeek }, { data: review }, { data: logs }] =
      await Promise.all([
        sb.from("runs").select("*", { count: "exact", head: true }).eq("user_id", uid).gte("created_at", startUtc.toISOString()),
        sb.from("runs").select("*", { count: "exact", head: true }).eq("user_id", uid),
        sb.from("clips").select("*", { count: "exact", head: true }).eq("user_id", uid).eq("status", "ready_for_approval"),
        sb.from("publish_jobs").select("*", { count: "exact", head: true }).eq("user_id", uid).in("status", ["pending", "retry"]),
        sb.from("published_posts").select("*", { count: "exact", head: true }).eq("user_id", uid),
        sb
          .from("activity_logs")
          .select("*", { count: "exact", head: true })
          .eq("user_id", uid)
          .eq("level", "error")
          .gte("created_at", new Date(Date.now() - 7 * 86400000).toISOString()),
        sb
          .from("published_posts")
          .select("published_at, views")
          .eq("user_id", uid)
          .gte("published_at", new Date(Date.now() - 7 * 86400000).toISOString()),
        sb
          .from("clips")
          .select("*")
          .eq("user_id", uid)
          .eq("status", "ready_for_approval")
          .order("created_at", { ascending: false })
          .limit(3),
        sb.from("activity_logs").select("*").eq("user_id", uid).order("created_at", { ascending: false }).limit(5)
      ]);

    const byDay = new Map<string, number>();
    for (const p of postsWeek ?? []) {
      const day = String(p.published_at).slice(0, 10);
      byDay.set(day, (byDay.get(day) ?? 0) + Number(p.views ?? 0));
    }
    const chart = [...byDay.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([day, views]) => ({ day, views }));

    reply.send({
      ok: true,
      kpis: {
        runs_today: runsToday ?? 0,
        total_runs: totalRuns ?? 0,
        clips_ready: clipsReady ?? 0,
        pending_publish: pendingPublish ?? 0,
        published: published ?? 0,
        errors_week: errorsWeek ?? 0
      },
      chart,
      review_clips: review ?? [],
      recent_logs: logs ?? []
    });
  });
}
