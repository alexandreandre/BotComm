import type { PoolClient } from "pg";

export type LogLevel = "info" | "warn" | "error" | "success";
export type LogCategory = "run" | "clip" | "caption" | "approval" | "publish" | "system";

export async function insertActivityLog(
  client: PoolClient,
  input: {
    userId: string;
    level: LogLevel;
    category: LogCategory;
    message: string;
    details?: string | null;
    entityId?: string | null;
    entityType?: string | null;
  }
): Promise<void> {
  await client.query(
    `INSERT INTO activity_logs (user_id, level, category, message, details, entity_id, entity_type)
     VALUES ($1, $2::log_level, $3::log_category, $4, $5, $6, $7)`,
    [
      input.userId,
      input.level,
      input.category,
      input.message,
      input.details ?? null,
      input.entityId ?? null,
      input.entityType ?? null
    ]
  );
}
