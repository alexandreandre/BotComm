import { useQuery } from "@tanstack/react-query";
import { useParams } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { PageHeader } from "../components/PageHeader";
import { Card, CardHeader, CardTitle } from "../components/ui/card";
import { apiFetch } from "../lib/api";

export function RunDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { user, supabase } = useAuth();
  const runQ = useQuery({
    queryKey: ["run", id],
    queryFn: () => apiFetch<{ run: Record<string, unknown> }>(supabase, `/api/runs/${id}`),
    enabled: !!user && !!id
  });
  const evQ = useQuery({
    queryKey: ["run-events", id],
    queryFn: () => apiFetch<{ events: Record<string, unknown>[] }>(supabase, `/api/runs/${id}/events`),
    enabled: !!user && !!id
  });

  if (runQ.isLoading) {
    return <p className="text-muted-foreground">Chargement…</p>;
  }
  if (runQ.isError || !runQ.data) {
    return <p className="text-destructive">{(runQ.error as Error)?.message ?? "Introuvable"}</p>;
  }
  const r = runQ.data.run;

  return (
    <div className="animate-fade-in">
      <PageHeader title={`Run ${String(r.id).slice(0, 8)}…`} description={String(r.strategy_name ?? "")} />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          ["Score", r.score],
          ["Streak", r.streak],
          ["Durée", `${r.duration}s`],
          ["Viral", r.viral_score]
        ].map(([k, v]) => (
          <Card key={String(k)}>
            <CardHeader>
              <CardTitle className="text-sm text-muted-foreground">{String(k)}</CardTitle>
              <p className="text-2xl font-bold text-primary">{String(v)}</p>
            </CardHeader>
          </Card>
        ))}
      </div>
      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Résumé</CardTitle>
          <p className="text-sm text-muted-foreground">{String(r.summary || "—")}</p>
        </CardHeader>
      </Card>
      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Timeline</CardTitle>
        </CardHeader>
        <div className="relative border-l border-border pl-6">
          {evQ.isLoading ? (
            <p className="text-sm text-muted-foreground">Chargement événements…</p>
          ) : (
            (evQ.data?.events ?? []).map((e) => (
              <div key={String(e.id)} className="mb-6 ml-2">
                <div className="absolute -left-[9px] mt-1 h-3 w-3 rounded-full bg-primary" />
                <p className="text-sm font-medium">{String(e.event_type)}</p>
                <p className="text-xs text-muted-foreground">{String(e.description)}</p>
                <p className="text-xs text-muted-foreground">{String(e.timestamp)}</p>
              </div>
            ))
          )}
        </div>
      </Card>
    </div>
  );
}
