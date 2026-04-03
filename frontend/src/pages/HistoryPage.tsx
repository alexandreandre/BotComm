import { useQuery } from "@tanstack/react-query";
import { useAuth } from "../auth/AuthContext";
import { PageHeader } from "../components/PageHeader";
import { PlatformBadge } from "../components/PlatformBadge";
import { apiFetch } from "../lib/api";

export function HistoryPage() {
  const { user, supabase } = useAuth();
  const q = useQuery({
    queryKey: ["history"],
    queryFn: () => apiFetch<{ posts: Record<string, unknown>[] }>(supabase, "/api/published-posts"),
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
      <PageHeader title="Historique" description="Posts publiés et métriques." />
      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full min-w-[900px] text-left text-sm">
          <thead className="border-b border-border bg-muted/30 text-xs uppercase text-muted-foreground">
            <tr>
              <th className="p-3">Post</th>
              <th className="p-3">Plateforme</th>
              <th className="p-3">Stratégie / Jeu</th>
              <th className="p-3">Caption</th>
              <th className="p-3">Vues</th>
              <th className="p-3">Likes</th>
              <th className="p-3">Com.</th>
              <th className="p-3">Partages</th>
              <th className="p-3">Date</th>
            </tr>
          </thead>
          <tbody>
            {q.data!.posts.map((p) => (
              <tr key={String(p.id)} className="border-b border-border/60 hover:bg-muted/20">
                <td className="p-3 font-mono text-xs">{String(p.external_post_id)}</td>
                <td className="p-3">
                  <PlatformBadge platform={String(p.platform)} />
                </td>
                <td className="p-3">
                  {String(p.strategy_name)}
                  <span className="block text-xs text-muted-foreground">{String(p.game)}</span>
                </td>
                <td className="max-w-xs truncate p-3">{String(p.caption)}</td>
                <td className="p-3">{String(p.views)}</td>
                <td className="p-3">{String(p.likes)}</td>
                <td className="p-3">{String(p.comments)}</td>
                <td className="p-3">{String(p.shares)}</td>
                <td className="p-3 text-xs text-muted-foreground">{String(p.published_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
