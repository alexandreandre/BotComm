import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "../auth/AuthContext";
import { PageHeader } from "../components/PageHeader";
import { VideoPlayer } from "../components/VideoPlayer";
import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";
import { apiFetch } from "../lib/api";

export function ReviewQueuePage() {
  const { user, supabase } = useAuth();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["review-queue"],
    queryFn: () => apiFetch<{ clips: Record<string, unknown>[] }>(supabase, "/api/clips/review-queue"),
    enabled: !!user
  });

  const approve = useMutation({
    mutationFn: (id: string) => apiFetch(supabase, `/api/clips/${id}/approve`, { method: "POST" }),
    onSuccess: async () => {
      toast.success("Approuvé");
      await qc.invalidateQueries({ queryKey: ["review-queue"] });
      await qc.invalidateQueries({ queryKey: ["clips"] });
    },
    onError: (e: Error) => toast.error(e.message)
  });

  const reject = useMutation({
    mutationFn: (id: string) => apiFetch(supabase, `/api/clips/${id}/reject`, { method: "POST" }),
    onSuccess: async () => {
      toast.success("Rejeté");
      await qc.invalidateQueries({ queryKey: ["review-queue"] });
    },
    onError: (e: Error) => toast.error(e.message)
  });

  if (q.isLoading) {
    return <p className="text-muted-foreground">Chargement…</p>;
  }
  if (q.isError) {
    return <p className="text-destructive">{(q.error as Error).message}</p>;
  }

  const clips = q.data!.clips;
  return (
    <div className="animate-fade-in">
      <PageHeader title="Review Queue" description="Clips en attente de validation." />
      {clips.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 py-24 text-muted-foreground">
          <CheckCircle2 className="h-14 w-14 text-success" />
          <p>Rien en attente — bravo.</p>
        </div>
      ) : (
        <div className="space-y-6">
          {clips.map((c) => (
            <Card key={String(c.id)} className="p-4">
              <div className="grid gap-4 md:grid-cols-[200px_1fr]">
                <VideoPlayer src={(c.video_url as string) ?? null} className="max-h-64" />
                <div className="space-y-2 text-sm">
                  <p className="font-medium">{String(c.game)}</p>
                  <p className="text-muted-foreground">{String(c.caption)}</p>
                  <p className="text-xs text-primary">
                    {(c.hashtags as string[])?.map((h) => `#${h}`).join(" ")}
                  </p>
                  <p className="text-xs text-muted-foreground">Premier com : {String(c.first_comment)}</p>
                  <div className="flex flex-wrap gap-2 pt-2">
                    <Button size="sm" type="button" onClick={() => approve.mutate(String(c.id))} disabled={approve.isPending}>
                      Approuver
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      type="button"
                      onClick={() => reject.mutate(String(c.id))}
                      disabled={reject.isPending}
                    >
                      Rejeter
                    </Button>
                  </div>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
