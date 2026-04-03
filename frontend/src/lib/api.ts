import type { SupabaseClient } from "@supabase/supabase-js";

const base = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? "";

export async function apiFetch<T>(
  supabase: SupabaseClient,
  path: string,
  init: RequestInit = {}
): Promise<T> {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  const res = await fetch(`${base}${path}`, { ...init, headers });
  const text = await res.text();
  const data = text ? (JSON.parse(text) as unknown) : null;
  if (!res.ok) {
    const err = data as { error?: string } | null;
    throw new Error(err?.error ?? `HTTP ${res.status}`);
  }
  return data as T;
}
