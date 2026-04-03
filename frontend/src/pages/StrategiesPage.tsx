import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Play, Pencil, Sparkles, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useAuth } from "../auth/AuthContext";
import { PageHeader } from "../components/PageHeader";
import { PlatformBadge } from "../components/PlatformBadge";
import { Button } from "../components/ui/button";
import { Card, CardHeader, CardTitle } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { apiFetch } from "../lib/api";

type Strategy = Record<string, unknown>;

const captionStyles = ["punchy", "clean", "suspense", "quiz_challenge", "movie_fans", "beat_this"] as const;

const emptyForm = {
  name: "",
  game: "",
  game_url: "",
  theme: "",
  bot_goal: "",
  content_angle: "",
  hook_template: "",
  caption_style: "punchy" as (typeof captionStyles)[number],
  platforms: ["tiktok"] as ("tiktok" | "instagram")[],
  target_clip_duration: 20,
  runs_to_launch: 3,
  status: "draft" as "draft" | "active" | "paused" | "archived"
};

export function StrategiesPage() {
  const { user, supabase } = useAuth();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Strategy | null>(null);
  const [form, setForm] = useState(emptyForm);

  const list = useQuery({
    queryKey: ["strategies"],
    queryFn: async () => {
      const r = await apiFetch<{ strategies: Strategy[] }>(supabase, "/api/strategies");
      return r.strategies;
    },
    enabled: !!user
  });

  const save = useMutation({
    mutationFn: async () => {
      if (editing) {
        await apiFetch(supabase, `/api/strategies/${editing.id}`, {
          method: "PATCH",
          body: JSON.stringify(form)
        });
      } else {
        await apiFetch(supabase, "/api/strategies", { method: "POST", body: JSON.stringify(form) });
      }
    },
    onSuccess: async () => {
      toast.success(editing ? "Stratégie mise à jour" : "Stratégie créée");
      setOpen(false);
      setEditing(null);
      setForm(emptyForm);
      await qc.invalidateQueries({ queryKey: ["strategies"] });
    },
    onError: (e: Error) => toast.error(e.message)
  });

  const del = useMutation({
    mutationFn: async (id: string) => apiFetch(supabase, `/api/strategies/${id}`, { method: "DELETE" }),
    onSuccess: async () => {
      toast.success("Supprimé");
      await qc.invalidateQueries({ queryKey: ["strategies"] });
    },
    onError: (e: Error) => toast.error(e.message)
  });

  const ai = useMutation({
    mutationFn: async (game: string) => {
      const r = await apiFetch<{ strategy: typeof form }>(supabase, "/api/ai/generate-strategy", {
        method: "POST",
        body: JSON.stringify({ game })
      });
      return r.strategy;
    },
    onSuccess: (s) => {
      setForm((f) => ({
        ...f,
        ...s,
        game_url: f.game_url,
        platforms: (s.platforms as ("tiktok" | "instagram")[]) ?? f.platforms
      }));
      toast.success("Champs pré-remplis par l’IA");
    },
    onError: (e: Error) => toast.error(e.message)
  });

  const play = useMutation({
    mutationFn: async (strategyId: string) =>
      apiFetch<{ run: Strategy; bot_dispatched: boolean; message: string }>(supabase, "/api/runs/play", {
        method: "POST",
        body: JSON.stringify({ strategy_id: strategyId })
      }),
    onSuccess: (r) => {
      toast.success(r.message);
      void qc.invalidateQueries({ queryKey: ["runs"] });
      void qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
    onError: (e: Error) => toast.error(e.message)
  });

  function openNew() {
    setEditing(null);
    setForm(emptyForm);
    setOpen(true);
  }

  function openEdit(s: Strategy) {
    setEditing(s);
    setForm({
      name: String(s.name ?? ""),
      game: String(s.game ?? ""),
      game_url: String(s.game_url ?? ""),
      theme: String(s.theme ?? ""),
      bot_goal: String(s.bot_goal ?? ""),
      content_angle: String(s.content_angle ?? ""),
      hook_template: String(s.hook_template ?? ""),
      caption_style: (s.caption_style as (typeof captionStyles)[number]) ?? "punchy",
      platforms: (s.platforms as ("tiktok" | "instagram")[]) ?? ["tiktok"],
      target_clip_duration: Number(s.target_clip_duration ?? 20),
      runs_to_launch: Number(s.runs_to_launch ?? 3),
      status: (s.status as typeof form.status) ?? "draft"
    });
    setOpen(true);
  }

  if (list.isLoading) {
    return <p className="text-muted-foreground">Chargement…</p>;
  }
  if (list.isError) {
    return <p className="text-destructive">{(list.error as Error).message}</p>;
  }

  return (
    <div className="animate-fade-in">
      <PageHeader
        title="Stratégies"
        description="Définis tes angles viraux et lance des runs bot."
        actions={
          <>
            <Button type="button" variant="secondary" onClick={openNew}>
              Nouvelle stratégie
            </Button>
          </>
        }
      />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {list.data!.map((s) => (
          <Card key={String(s.id)} className="flex flex-col">
            <CardHeader>
              <CardTitle className="text-gradient-gold">{String(s.name)}</CardTitle>
              <p className="text-sm text-muted-foreground">{String(s.game)}</p>
            </CardHeader>
            <div className="flex flex-1 flex-col gap-2 px-4 pb-4 text-xs text-muted-foreground">
              <p className="line-clamp-2">
                <span className="text-foreground/80">URL :</span> {String(s.game_url) || "—"}
              </p>
              <p className="line-clamp-2">
                <span className="text-foreground/80">Objectif bot :</span> {String(s.bot_goal)}
              </p>
              <p className="line-clamp-2">
                <span className="text-foreground/80">Hook :</span> {String(s.hook_template)}
              </p>
              <div className="flex flex-wrap gap-2">
                {(s.platforms as string[] | undefined)?.map((p) => <PlatformBadge key={p} platform={p} />)}
              </div>
              <p>
                Style : <span className="text-primary">{String(s.caption_style)}</span> · Durée {String(s.target_clip_duration)}s · Runs{" "}
                {String(s.run_count ?? 0)}
              </p>
              <div className="mt-auto flex flex-wrap gap-2 pt-2">
                <Button size="sm" type="button" onClick={() => play.mutate(String(s.id))} disabled={play.isPending}>
                  <Play className="h-3 w-3" /> Lancer
                </Button>
                <Button size="sm" variant="secondary" type="button" onClick={() => openEdit(s)}>
                  <Pencil className="h-3 w-3" /> Modifier
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  type="button"
                  onClick={() => {
                    if (confirm("Supprimer cette stratégie ?")) {
                      del.mutate(String(s.id));
                    }
                  }}
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
            </div>
          </Card>
        ))}
      </div>

      {open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="glass max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl p-6">
            <h2 className="mb-4 text-lg font-semibold text-gradient-gold">{editing ? "Modifier" : "Créer"} une stratégie</h2>
            <div className="mb-4 flex gap-2">
              <Input
                placeholder="Nom du jeu pour l’IA"
                id="ai-game"
                defaultValue={form.game}
                onBlur={(e) => setForm((f) => ({ ...f, game: e.target.value }))}
              />
              <Button
                type="button"
                variant="secondary"
                disabled={ai.isPending}
                onClick={() => {
                  const g = form.game.trim();
                  if (!g) {
                    toast.error("Renseigne le jeu");
                    return;
                  }
                  ai.mutate(g);
                }}
              >
                <Sparkles className="h-4 w-4" /> IA
              </Button>
            </div>
            <div className="grid gap-3">
              <Field label="Nom" value={form.name} onChange={(v) => setForm((f) => ({ ...f, name: v }))} />
              <Field label="Jeu" value={form.game} onChange={(v) => setForm((f) => ({ ...f, game: v }))} />
              <Field label="URL du jeu" value={form.game_url} onChange={(v) => setForm((f) => ({ ...f, game_url: v }))} />
              <Field label="Thème" value={form.theme} onChange={(v) => setForm((f) => ({ ...f, theme: v }))} />
              <Field label="Objectif bot" value={form.bot_goal} onChange={(v) => setForm((f) => ({ ...f, bot_goal: v }))} />
              <Field label="Angle viral" value={form.content_angle} onChange={(v) => setForm((f) => ({ ...f, content_angle: v }))} />
              <Field label="Hook" value={form.hook_template} onChange={(v) => setForm((f) => ({ ...f, hook_template: v }))} />
              <div>
                <label className="mb-1 block text-xs text-muted-foreground">Style caption</label>
                <select
                  className="h-10 w-full rounded-lg border border-border bg-muted/40 px-2 text-sm"
                  value={form.caption_style}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, caption_style: e.target.value as (typeof captionStyles)[number] }))
                  }
                >
                  {captionStyles.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex gap-4">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={form.platforms.includes("tiktok")}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        platforms: e.target.checked
                          ? [...f.platforms, "tiktok"]
                          : f.platforms.filter((p) => p !== "tiktok")
                      }))
                    }
                  />
                  TikTok
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={form.platforms.includes("instagram")}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        platforms: e.target.checked
                          ? [...f.platforms, "instagram"]
                          : f.platforms.filter((p) => p !== "instagram")
                      }))
                    }
                  />
                  Instagram
                </label>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="mb-1 block text-xs text-muted-foreground">Durée clip (s)</label>
                  <Input
                    type="number"
                    value={form.target_clip_duration}
                    onChange={(e) => setForm((f) => ({ ...f, target_clip_duration: Number(e.target.value) }))}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-muted-foreground">Runs à lancer</label>
                  <Input
                    type="number"
                    value={form.runs_to_launch}
                    onChange={(e) => setForm((f) => ({ ...f, runs_to_launch: Number(e.target.value) }))}
                  />
                </div>
              </div>
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                Annuler
              </Button>
              <Button type="button" onClick={() => save.mutate()} disabled={save.isPending}>
                Enregistrer
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label className="mb-1 block text-xs text-muted-foreground">{label}</label>
      <Input value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}
