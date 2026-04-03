import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { PageHeader } from "../components/PageHeader";
import { StatusBadge } from "../components/StatusBadge";
import { apiFetch } from "../lib/api";

export function RunsPage() {
  const { user, supabase } = useAuth();
  const q = useQuery({
    queryKey: ["runs"],
    queryFn: async () => {
      const r = await apiFetch<{ runs: Record<string, unknown>[] }>(supabase, "/api/runs");
      return r.runs;
    },
    enabled: !!user
  });

  if (q.isLoading) {
    return <p className="text-muted-foreground">Chargement…</p>;
  }
  if (q.isError) {
    return <p className="text-destructive">{(q.error as Error).message}</p>;
  }

  return (
    <div className="animate-fade-in">
      <PageHeader title="Runs" description="Sessions bot enregistrées." />
      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full min-w-[800px] text-left text-sm">
          <thead className="border-b border-border bg-muted/30 text-xs uppercase text-muted-foreground">
            <tr>
              <th className="p-3">Run</th>
              <th className="p-3">Stratégie</th>
              <th className="p-3">Jeu / Thème</th>
              <th className="p-3">Score</th>
              <th className="p-3">Streak</th>
              <th className="p-3">Durée</th>
              <th className="p-3">Viral</th>
              <th className="p-3">Statut</th>
              <th className="p-3">Date</th>
            </tr>
          </thead>
          <tbody>
            {q.data!.map((r) => (
              <tr key={String(r.id)} className="border-b border-border/60 hover:bg-muted/20">
                <td className="p-3 font-mono text-xs">
                  <Link className="text-primary hover:underline" to={`/runs/${String(r.id)}`}>
                    {(String(r.id)).slice(0, 8)}…
                  </Link>
                </td>
                <td className="p-3">{String(r.strategy_name ?? "")}</td>
                <td className="p-3">
                  {String(r.game)}
                  <span className="block text-xs text-muted-foreground">{String(r.theme)}</span>
                </td>
                <td className="p-3">{String(r.score)}</td>
                <td className="p-3">{String(r.streak)}</td>
                <td className="p-3">{String(r.duration)}s</td>
                <td className="p-3">{String(r.viral_score)}</td>
                <td className="p-3">
                  <StatusBadge kind="run" status={String(r.status)} />
                </td>
                <td className="p-3 text-xs text-muted-foreground">{String(r.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
