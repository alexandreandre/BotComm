import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { toast } from "sonner";
import { useAuth } from "../auth/AuthContext";
import { PageHeader } from "../components/PageHeader";
import { PlatformBadge } from "../components/PlatformBadge";
import { StatusBadge } from "../components/StatusBadge";
import { VideoPlayer } from "../components/VideoPlayer";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { apiFetch } from "../lib/api";

export function ClipDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { user, supabase } = useAuth();
  const qc = useQueryClient();
  const [caption, setCaption] = useState("");
  const [hashtags, setHashtags] = useState("");
  const [firstComment, setFirstComment] = useState("");
  const [scheduled, setScheduled] = useState("");

  const clipQ = useQuery({
    queryKey: ["clip", id],
    queryFn: () => apiFetch<{ clip: Record<string, unknown> }>(supabase, `/api/clips/${id}`),
    enabled: !!user && !!id
  });

  const jobsQ = useQuery({
    queryKey: ["publish-jobs", id],
    queryFn: () =>
      apiFetch<{ jobs: Record<string, unknown>[] }>(supabase, `/api/publish-jobs?clip_id=${encodeURIComponent(id!)}`),
    enabled: !!user && !!id
  });

  useEffect(() => {
    const c = clipQ.data?.clip;
    if (!c) {
      return;
    }
    setCaption(String(c.caption ?? ""));
    setHashtags(Array.isArray(c.hashtags) ? (c.hashtags as string[]).join(" ") : "");
    setFirstComment(String(c.first_comment ?? ""));
  }, [clipQ.data?.clip]);

  const save = useMutation({
    mutationFn: async () => {
      const tags = hashtags
        .split(/[\s#,]+/)
        .map((t) => t.trim())
        .filter(Boolean);
      await apiFetch(supabase, `/api/clips/${id}`, {
        method: "PATCH",
        body: JSON.stringify({
          caption,
          hashtags: tags,
          first_comment: firstComment,
          scheduled_at: scheduled ? new Date(scheduled).toISOString() : null
        })
      });
    },
    onSuccess: async () => {
      toast.success("Enregistré");
      await qc.invalidateQueries({ queryKey: ["clip", id] });
    },
    onError: (e: Error) => toast.error(e.message)
  });

  const approve = useMutation({
    mutationFn: () => apiFetch<{ publish_job: Record<string, unknown> }>(supabase, `/api/clips/${id}/approve`, { method: "POST" }),
    onSuccess: async () => {
      toast.success("Approuvé");
      await qc.invalidateQueries({ queryKey: ["clip", id] });
      await qc.invalidateQueries({ queryKey: ["publish-jobs", id] });
    },
    onError: (e: Error) => toast.error(e.message)
  });

  const reject = useMutation({
    mutationFn: () => apiFetch(supabase, `/api/clips/${id}/reject`, { method: "POST" }),
    onSuccess: async () => {
      toast.success("Rejeté");
      await qc.invalidateQueries({ queryKey: ["clip", id] });
    },
    onError: (e: Error) => toast.error(e.message)
  });

  const renderClip = useMutation({
    mutationFn: () => apiFetch(supabase, `/api/clips/${id}/render`, { method: "POST" }),
    onSuccess: async () => {
      toast.success("Rendu (placeholder)");
      await qc.invalidateQueries({ queryKey: ["clip", id] });
    },
    onError: (e: Error) => toast.error(e.message)
  });

  const publish = useMutation({
    mutationFn: (jobId: string) => apiFetch(supabase, `/api/publish-jobs/${jobId}/publish`, { method: "POST" }),
    onSuccess: async () => {
      toast.success("Publication simulée");
      await qc.invalidateQueries({ queryKey: ["publish-jobs", id] });
    },
    onError: (e: Error) => toast.error(e.message)
  });

  if (clipQ.isLoading) {
    return <p className="text-muted-foreground">Chargement…</p>;
  }
  if (clipQ.isError || !clipQ.data) {
    return <p className="text-destructive">{(clipQ.error as Error)?.message ?? "Introuvable"}</p>;
  }
  const c = clipQ.data.clip;
  const status = String(c.status);
  const pendingJob = jobsQ.data?.jobs?.find((j) => j.status === "pending" || j.status === "retry") as
    | Record<string, unknown>
    | undefined;

  return (
    <div className="animate-fade-in">
      <PageHeader
        title={String(c.game)}
        actions={
          <div className="flex flex-wrap gap-2">
            <PlatformBadge platform={String(c.platform)} />
            <StatusBadge kind="clip" status={status} />
          </div>
        }
      />
      <div className="grid gap-8 lg:grid-cols-2">
        <VideoPlayer src={(c.video_url as string) ?? null} />
        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">Légende</label>
            <textarea
              className="min-h-[100px] w-full rounded-lg border border-border bg-muted/40 p-3 text-sm"
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">Hashtags (espaces)</label>
            <Input value={hashtags} onChange={(e) => setHashtags(e.target.value)} />
          </div>
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">Premier commentaire</label>
            <Input value={firstComment} onChange={(e) => setFirstComment(e.target.value)} />
          </div>
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">Planification (local)</label>
            <Input type="datetime-local" value={scheduled} onChange={(e) => setScheduled(e.target.value)} />
          </div>
          <Button type="button" onClick={() => save.mutate()} disabled={save.isPending}>
            Sauvegarder
          </Button>

          {status === "ready_for_approval" ? (
            <div className="flex flex-wrap gap-2 border-t border-border pt-4">
              <Button type="button" onClick={() => approve.mutate()} disabled={approve.isPending}>
                Approuver
              </Button>
              <Button type="button" variant="destructive" onClick={() => reject.mutate()} disabled={reject.isPending}>
                Rejeter
              </Button>
              <Button type="button" variant="secondary" onClick={() => renderClip.mutate()} disabled={renderClip.isPending}>
                Régénérer rendu
              </Button>
            </div>
          ) : null}

          {status === "approved" && pendingJob ? (
            <div className="border-t border-border pt-4">
              <Button type="button" onClick={() => publish.mutate(String(pendingJob.id))} disabled={publish.isPending}>
                Publier (simulation)
              </Button>
            </div>
          ) : null}

          <div className="rounded-lg border border-border bg-muted/20 p-4 text-sm">
            <p className="text-xs font-semibold text-muted-foreground">Aperçu</p>
            <p className="mt-2 whitespace-pre-wrap">{caption}</p>
            <p className="mt-2 text-primary">
              {hashtags
                .split(/\s+/)
                .filter(Boolean)
                .map((t) => `#${t.replace(/^#/, "")}`)
                .join(" ")}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
