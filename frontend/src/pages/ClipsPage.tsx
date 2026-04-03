import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { PageHeader } from "../components/PageHeader";
import { PlatformBadge } from "../components/PlatformBadge";
import { StatusBadge } from "../components/StatusBadge";
import { VideoPlayer } from "../components/VideoPlayer";
import { Card, CardHeader, CardTitle } from "../components/ui/card";
import { apiFetch } from "../lib/api";

export function ClipsPage() {
  const { user, supabase } = useAuth();
  const q = useQuery({
    queryKey: ["clips"],
    queryFn: async () => {
      const r = await apiFetch<{ clips: Record<string, unknown>[] }>(supabase, "/api/clips");
      return r.clips;
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
      <PageHeader title="Clips" description="Montages et statuts de publication." />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {q.data!.map((c) => (
          <Card key={String(c.id)} className="overflow-hidden">
            <VideoPlayer src={(c.video_url as string) ?? null} className="max-h-56 rounded-none border-0" />
            <CardHeader>
              <div className="flex flex-wrap items-center gap-2">
                <CardTitle className="text-base">
                  <Link className="hover:text-primary" to={`/clips/${String(c.id)}`}>
                    {String(c.game)}
                  </Link>
                </CardTitle>
                <PlatformBadge platform={String(c.platform)} />
                <StatusBadge kind="clip" status={String(c.status)} />
                <span className="text-xs text-muted-foreground">v{String(c.version)}</span>
              </div>
              <p className="line-clamp-3 text-sm text-muted-foreground">{String(c.caption)}</p>
              <p className="text-xs text-muted-foreground">{String(c.duration)}s</p>
            </CardHeader>
          </Card>
        ))}
      </div>
    </div>
  );
}
