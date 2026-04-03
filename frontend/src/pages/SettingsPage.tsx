import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useAuth } from "../auth/AuthContext";
import { PageHeader } from "../components/PageHeader";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { apiFetch } from "../lib/api";

const defaultKeys = [
  ["game_site_url", "URL site jeux"],
  ["default_caption_style", "Style caption défaut"],
  ["video_format", "Format vidéo"],
  ["default_hook", "Hook défaut"],
  ["default_cta", "CTA défaut"],
  ["auto_publish", "auto-publish (true/false)"],
  ["max_retries", "Max retries publication"]
] as const;

export function SettingsPage() {
  const { user, supabase } = useAuth();
  const qc = useQueryClient();
  const [values, setValues] = useState<Record<string, string>>({});

  const q = useQuery({
    queryKey: ["settings"],
    queryFn: () => apiFetch<{ settings: Record<string, string> }>(supabase, "/api/settings"),
    enabled: !!user
  });

  useEffect(() => {
    if (q.data?.settings) {
      setValues(q.data.settings);
    }
  }, [q.data?.settings]);

  const integ = useQuery({
    queryKey: ["integrations"],
    queryFn: () => apiFetch<{ integrations: Record<string, unknown>[] }>(supabase, "/api/integrations"),
    enabled: !!user
  });

  const save = useMutation({
    mutationFn: async () => {
      await apiFetch(supabase, "/api/settings", { method: "PUT", body: JSON.stringify(values) });
    },
    onSuccess: async () => {
      toast.success("Paramètres enregistrés");
      await qc.invalidateQueries({ queryKey: ["settings"] });
    },
    onError: (e: Error) => toast.error(e.message)
  });

  const toggleInteg = useMutation({
    mutationFn: async ({ platform, connected }: { platform: string; connected: boolean }) => {
      await apiFetch(supabase, `/api/integrations/${encodeURIComponent(platform)}`, {
        method: "PUT",
        body: JSON.stringify({ connected, name: platform })
      });
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["integrations"] });
    },
    onError: (e: Error) => toast.error(e.message)
  });

  if (q.isLoading || integ.isLoading) {
    return <p className="text-muted-foreground">Chargement…</p>;
  }
  if (q.isError) {
    return <p className="text-destructive">{(q.error as Error).message}</p>;
  }

  const platforms = ["game_site", "instagram", "tiktok"];
  const existing = new Map(integ.data!.integrations.map((i) => [String(i.platform), i]));

  return (
    <div className="animate-fade-in">
      <PageHeader title="Paramètres" description="Intégrations et préférences." />
      <section className="mb-10 rounded-xl border border-border p-6">
        <h2 className="mb-4 text-lg font-semibold text-primary">Intégrations</h2>
        <div className="space-y-3">
          {platforms.map((p) => {
            const row = existing.get(p) as { connected?: boolean } | undefined;
            const connected = Boolean(row?.connected);
            return (
              <div key={p} className="flex items-center justify-between rounded-lg bg-muted/30 px-4 py-3">
                <div>
                  <p className="font-medium capitalize">{p.replace("_", " ")}</p>
                  <p className="text-xs text-muted-foreground">{connected ? "Connecté" : "Déconnecté"}</p>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant={connected ? "secondary" : "default"}
                  onClick={() => toggleInteg.mutate({ platform: p, connected: !connected })}
                  disabled={toggleInteg.isPending}
                >
                  {connected ? "Déconnecter" : "Connecter"}
                </Button>
              </div>
            );
          })}
        </div>
      </section>
      <section className="rounded-xl border border-border p-6">
        <h2 className="mb-4 text-lg font-semibold text-primary">Général</h2>
        <div className="grid gap-4 md:grid-cols-2">
          {defaultKeys.map(([key, label]) => (
            <div key={key}>
              <label className="mb-1 block text-xs text-muted-foreground">{label}</label>
              <Input value={values[key] ?? ""} onChange={(e) => setValues((v) => ({ ...v, [key]: e.target.value }))} />
            </div>
          ))}
        </div>
        <Button type="button" className="mt-6" onClick={() => save.mutate()} disabled={save.isPending}>
          Sauvegarder
        </Button>
      </section>
    </div>
  );
}
