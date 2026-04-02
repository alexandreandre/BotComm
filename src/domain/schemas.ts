import { z } from "zod";

export const dispatchPayloadSchema = z
  .object({
    run_id: z.string().uuid(),
    callback_token: z.string().uuid(),
    webhook_url: z.string().url(),
    game_url: z.string().url(),
    game: z.string().min(1).max(120),
    bot_goal: z.string().min(1).max(500),
    max_duration_seconds: z.number().int().positive().max(3600),
    storage_bucket: z.string().min(1).max(128),
    storage_path: z.string().min(1).max(512)
  })
  .strict();

export type DispatchPayloadInput = z.infer<typeof dispatchPayloadSchema>;
