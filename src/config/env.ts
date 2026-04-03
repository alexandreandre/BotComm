import { z } from "zod";

const envSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    PORT: z.coerce.number().int().positive().default(8080),
    LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
    BODY_LIMIT_BYTES: z.coerce.number().int().positive().default(1048576 * 5),
    STORAGE_BACKEND: z.enum(["supabase", "gcs"]).default("supabase"),
    SUPABASE_URL: z.preprocess(
      (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
      z.string().url().optional()
    ),
    SUPABASE_SERVICE_ROLE_KEY: z.preprocess(
      (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
      z.string().min(1).optional()
    ),
    GCS_BUCKET: z.string().min(1).optional(),
    DATABASE_URL: z.string().min(1).optional(),
    /**
     * SSL pour pg : auto = activer si l’hôte ressemble à Supabase (recommandé en prod).
     * Désactiver explicitement en local si besoin : DATABASE_SSL=false
     */
    DATABASE_SSL: z.enum(["auto", "true", "false"]).default("auto"),
    GEMINI_API_KEY: z.string().min(1).optional(),
    /** URL publique du service Cloud Run (webhook bot), sans slash final */
    PUBLIC_APP_URL: z.string().url().optional(),
    PLAYWRIGHT_HEADLESS: z
      .string()
      .optional()
      .transform((value) => (value ?? "true").toLowerCase() !== "false"),
    PLAYWRIGHT_NAV_TIMEOUT_MS: z.coerce.number().int().positive().default(30000),
    WEBHOOK_TIMEOUT_MS: z.coerce.number().int().positive().default(10000),
    WEBHOOK_MAX_RETRIES: z.coerce.number().int().nonnegative().default(3),
    MAX_RUN_TIMEOUT_MS: z.coerce.number().int().positive().default(120000),
    RUN_CONCURRENCY_LIMIT: z.coerce.number().int().positive().default(2),
    DEFAULT_STORAGE_BUCKET: z.string().min(1).default("gameplay-videos"),
    /** Chemin vers le build statique du frontend (optionnel, prod) */
    FRONTEND_DIST_PATH: z.string().min(1).optional()
  })
  .superRefine((data, ctx) => {
    if (data.STORAGE_BACKEND === "supabase") {
      if (!data.SUPABASE_URL) {
        ctx.addIssue({ code: "custom", message: "SUPABASE_URL requis si STORAGE_BACKEND=supabase" });
      }
      if (!data.SUPABASE_SERVICE_ROLE_KEY) {
        ctx.addIssue({
          code: "custom",
          message: "SUPABASE_SERVICE_ROLE_KEY requis si STORAGE_BACKEND=supabase"
        });
      }
    }
    if (data.STORAGE_BACKEND === "gcs") {
      if (!data.GCS_BUCKET) {
        ctx.addIssue({ code: "custom", message: "GCS_BUCKET requis si STORAGE_BACKEND=gcs" });
      }
    }
    if (data.DATABASE_URL && (!data.SUPABASE_URL || !data.SUPABASE_SERVICE_ROLE_KEY)) {
      ctx.addIssue({
        code: "custom",
        message:
          "SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY requis avec DATABASE_URL (auth JWT Supabase pour /api/*)"
      });
    }
  });

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  throw new Error(`Invalid environment variables: ${parsed.error.message}`);
}

export const env = parsed.data;

export function requireDatabaseUrl(): string {
  if (!env.DATABASE_URL) {
    throw new Error("DATABASE_URL non configuré");
  }
  return env.DATABASE_URL;
}

export function requirePublicAppUrl(): string {
  if (!env.PUBLIC_APP_URL) {
    throw new Error("PUBLIC_APP_URL non configuré (URL du service pour le webhook bot)");
  }
  return env.PUBLIC_APP_URL.replace(/\/+$/, "");
}
