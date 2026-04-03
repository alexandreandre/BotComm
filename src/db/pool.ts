import { Pool, type PoolClient } from "pg";
import { env, requireDatabaseUrl } from "../config/env";

function sslOptionForDatabaseUrl(connectionString: string): boolean | { rejectUnauthorized: boolean } | undefined {
  const mode = env.DATABASE_SSL;
  if (mode === "false") {
    return undefined;
  }
  if (mode === "true") {
    return { rejectUnauthorized: false };
  }
  // auto : Supabase hébergé (et pooler *.pooler.supabase.com)
  if (/supabase\.(co|com|in)\b/i.test(connectionString) || /\.pooler\.supabase\.com\b/i.test(connectionString)) {
    return { rejectUnauthorized: false };
  }
  if (connectionString.includes("sslmode=require") || connectionString.includes("sslmode=verify-full")) {
    return { rejectUnauthorized: false };
  }
  return undefined;
}

let pool: Pool | null = null;

export function getPool(): Pool {
  if (!pool) {
    const connectionString = requireDatabaseUrl();
    pool = new Pool({
      connectionString,
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
      ssl: sslOptionForDatabaseUrl(connectionString)
    });
  }
  return pool;
}

export async function withClient<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const p = getPool();
  const client = await p.connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}
