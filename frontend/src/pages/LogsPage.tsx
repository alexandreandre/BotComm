import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useAuth } from "../auth/AuthContext";
import { PageHeader } from "../components/PageHeader";
import { StatusBadge } from "../components/StatusBadge";
import { Button } from "../components/ui/button";
import { apiFetch } from "../lib/api";

const cats = ["all", "run", "clip", "caption", "approval", "publish", "system"] as const;

export function LogsPage() {
  const { user, supabase } = useAuth();
  const [cat, setCat] = useState<(typeof cats)[number]>("all");
  const q = useQuery({
    queryKey: ["logs", cat],
    queryFn: () =>
      apiFetch<{ logs: Record<string, unknown>[] }>(
        supabase,
        cat === "all" ? "/api/activity-logs" : `/api/activity-logs?category=${cat}`
      ),
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
      <PageHeader title="Logs d’activité" description="Filtrer par catégorie." />
      <div className="mb-4 flex flex-wrap gap-2">
        {cats.map((c) => (
          <Button
            key={c}
            type="button"
            size="sm"
            variant={cat === c ? "default" : "secondary"}
            onClick={() => setCat(c)}
          >
            {c}
          </Button>
        ))}
      </div>
      <ul className="space-y-2 rounded-xl border border-border p-4">
        {q.data!.logs.map((l) => (
          <li key={String(l.id)} className="flex flex-col gap-1 border-b border-border/50 py-3 text-sm last:border-0 md:flex-row md:items-center md:gap-4">
            <StatusBadge kind="log" status={String(l.level)} />
            <span className="text-xs uppercase text-muted-foreground">{String(l.category)}</span>
            <span className="flex-1">{String(l.message)}</span>
            {l.details ? <span className="text-xs text-muted-foreground">{String(l.details)}</span> : null}
            <span className="text-xs text-muted-foreground">{String(l.created_at)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
