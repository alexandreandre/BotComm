import { getSupabaseAdmin } from "./supabase-auth";

export type LogLevel = "info" | "warn" | "error" | "success";
export type LogCategory = "run" | "clip" | "caption" | "approval" | "publish" | "system";

export async function insertActivityLog(input: {
  userId: string;
  level: LogLevel;
  category: LogCategory;
  message: string;
  details?: string | null;
  entityId?: string | null;
  entityType?: string | null;
}): Promise<void> {
  const sb = getSupabaseAdmin();
  const { error } = await sb.from("activity_logs").insert({
    user_id: input.userId,
    level: input.level,
    category: input.category,
    message: input.message,
    details: input.details ?? null,
    entity_id: input.entityId ?? null,
    entity_type: input.entityType ?? null
  });
  if (error) {
    throw error;
  }
}
