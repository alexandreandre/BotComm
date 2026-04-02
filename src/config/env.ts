import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(8080),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  BODY_LIMIT_BYTES: z.coerce.number().int().positive().default(1048576),
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  DEFAULT_STORAGE_BUCKET: z.string().min(1).default("gameplay-videos"),
  PLAYWRIGHT_HEADLESS: z
    .string()
    .optional()
    .transform((value) => (value ?? "true").toLowerCase() !== "false"),
  PLAYWRIGHT_NAV_TIMEOUT_MS: z.coerce.number().int().positive().default(30000),
  WEBHOOK_TIMEOUT_MS: z.coerce.number().int().positive().default(10000),
  WEBHOOK_MAX_RETRIES: z.coerce.number().int().nonnegative().default(3),
  MAX_RUN_TIMEOUT_MS: z.coerce.number().int().positive().default(120000),
  RUN_CONCURRENCY_LIMIT: z.coerce.number().int().positive().default(2)
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  throw new Error(`Invalid environment variables: ${parsed.error.message}`);
}

export const env = parsed.data;
