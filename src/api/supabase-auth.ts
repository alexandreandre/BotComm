import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env } from "../config/env";

let adminClient: SupabaseClient | null = null;

/** Client service_role : accès PostgREST complet (serveur uniquement). */
export function getSupabaseAdmin(): SupabaseClient {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY requis pour l’API");
  }
  if (!adminClient) {
    adminClient = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false }
    });
  }
  return adminClient;
}

/** Valide le JWT utilisateur (header Authorization: Bearer) via GoTrue. */
export async function verifySupabaseUserJwt(accessToken: string): Promise<{ id: string; email?: string }> {
  const { data, error } = await getSupabaseAdmin().auth.getUser(accessToken);
  if (error || !data.user) {
    throw new Error(error?.message ?? "Token invalide");
  }
  const u = data.user;
  const out: { id: string; email?: string } = { id: u.id };
  if (u.email !== undefined) {
    out.email = u.email;
  }
  return out;
}
