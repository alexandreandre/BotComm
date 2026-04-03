import { useQuery } from "@tanstack/react-query";
import { Activity, AlertTriangle, CheckCircle2, ListVideo, Play, Send } from "lucide-react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useAuth } from "../auth/AuthContext";
import { KpiCard } from "../components/KpiCard";
import { PageHeader } from "../components/PageHeader";
import { PlatformBadge } from "../components/PlatformBadge";
import { StatusBadge } from "../components/StatusBadge";
import { VideoPlayer } from "../components/VideoPlayer";
import { Card, CardHeader, CardTitle } from "../components/ui/card";
import { apiFetch } from "../lib/api";

type DashboardRes = {
  ok: boolean;
  kpis: {
    runs_today: number;
    total_runs: number;
    clips_ready: number;
    pending_publish: number;
    published: number;
    errors_week: number;
  };
  chart: { day: string; views: number }[];
  review_clips: Record<string, unknown>[];
  recent_logs: Record<string, unknown>[];
};

export function DashboardPage() {
  const { user, supabase } = useAuth();
  const q = useQuery({
    queryKey: ["dashboard"],
    queryFn: () => apiFetch<DashboardRes>(supabase, "/api/dashboard/summary"),
    enabled: !!user
  });

  if (q.isLoading) {
    return <p className="text-muted-foreground">Chargement…</p>;
  }
  if (q.isError) {
    return <p className="text-destructive">{(q.error as Error).message}</p>;
  }
  const d = q.data!;

  return (
    <div className="animate-fade-in">
      <PageHeader title="Dashboard" description="Vue d’ensemble de ton studio viral." />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <KpiCard title="Runs aujourd’hui" value={d.kpis.runs_today} icon={Play} variant="gold" />
        <KpiCard title="Total runs" value={d.kpis.total_runs} icon={Activity} />
        <KpiCard title="Clips prêts" value={d.kpis.clips_ready} icon={CheckCircle2} />
        <KpiCard title="En attente pub" value={d.kpis.pending_publish} icon={Send} />
        <KpiCard title="Publiés" value={d.kpis.published} icon={ListVideo} />
        <KpiCard title="Erreurs (7j)" value={d.kpis.errors_week} icon={AlertTriangle} variant="accent" />
      </div>
      <div className="mt-8 grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Performances 7 jours (vues)</CardTitle>
          </CardHeader>
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={d.chart}>
                <defs>
                  <linearGradient id="v" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="hsl(40 90% 55%)" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="hsl(40 90% 55%)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(220 14% 20%)" />
                <XAxis dataKey="day" stroke="hsl(215 12% 50%)" fontSize={11} />
                <YAxis stroke="hsl(215 12% 50%)" fontSize={11} />
                <Tooltip
                  contentStyle={{ background: "hsl(220 18% 10%)", border: "1px solid hsl(220 14% 16%)" }}
                  labelStyle={{ color: "hsl(210 20% 92%)" }}
                />
                <Area type="monotone" dataKey="views" stroke="hsl(40 90% 55%)" fill="url(#v)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Mini review</CardTitle>
          </CardHeader>
          <div className="space-y-4">
            {d.review_clips.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-8 text-muted-foreground">
                <CheckCircle2 className="h-10 w-10 text-success" />
                <p className="text-sm">Rien en attente</p>
              </div>
            ) : (
              d.review_clips.map((c) => (
                <div key={String(c.id)} className="rounded-lg border border-border p-3">
                  <VideoPlayer src={(c.video_url as string) ?? null} className="mx-auto max-h-48" />
                  <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">{String(c.caption ?? "")}</p>
                  <div className="mt-2 flex gap-2">
                    <PlatformBadge platform={String(c.platform)} />
                    <StatusBadge kind="clip" status={String(c.status)} />
                  </div>
                </div>
              ))
            )}
          </div>
        </Card>
      </div>
      <Card className="mt-8">
        <CardHeader>
          <CardTitle>Activité récente</CardTitle>
        </CardHeader>
        <ul className="space-y-2">
          {d.recent_logs.map((l) => (
            <li key={String(l.id)} className="flex flex-wrap items-center gap-2 text-sm">
              <StatusBadge kind="log" status={String(l.level)} />
              <span className="text-muted-foreground">{String(l.category)}</span>
              <span>{String(l.message)}</span>
              <span className="text-xs text-muted-foreground">{String(l.created_at)}</span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
