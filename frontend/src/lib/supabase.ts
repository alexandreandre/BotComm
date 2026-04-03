import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let browserClient: SupabaseClient | null = null;

export function getSupabaseBrowserClient(): SupabaseClient {
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
  if (!url || !anon) {
    throw new Error("VITE_SUPABASE_URL et VITE_SUPABASE_ANON_KEY sont requis");
  }
  if (!browserClient) {
    browserClient = createClient(url, anon);
  }
  return browserClient;
}
