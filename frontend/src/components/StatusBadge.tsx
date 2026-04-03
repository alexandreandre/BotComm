import { cn } from "../lib/utils";

const runColors: Record<string, string> = {
  pending: "bg-warning/20 text-warning",
  running: "bg-primary/20 text-primary",
  completed: "bg-success/20 text-success",
  failed: "bg-destructive/20 text-destructive",
  cancelled: "bg-muted text-muted-foreground"
};

const clipColors: Record<string, string> = {
  rendering: "bg-warning/20 text-warning",
  rendered: "bg-muted text-muted-foreground",
  ready_for_approval: "bg-primary/20 text-primary",
  approved: "bg-success/20 text-success",
  rejected: "bg-destructive/20 text-destructive",
  failed: "bg-destructive/20 text-destructive"
};

export function StatusBadge({
  kind,
  status
}: {
  kind: "run" | "clip" | "publish" | "strategy" | "log";
  status: string;
}) {
  const map =
    kind === "run"
      ? runColors
      : kind === "clip"
        ? clipColors
        : kind === "publish"
          ? {
              pending: "bg-muted text-muted-foreground",
              publishing: "bg-warning/20 text-warning",
              published: "bg-success/20 text-success",
              failed: "bg-destructive/20 text-destructive",
              retry: "bg-primary/20 text-primary"
            }
          : kind === "strategy"
            ? {
                draft: "bg-muted text-muted-foreground",
                active: "bg-success/20 text-success",
                paused: "bg-warning/20 text-warning",
                archived: "bg-muted-foreground/30 text-muted-foreground"
              }
            : {
                info: "bg-muted text-muted-foreground",
                warn: "bg-warning/20 text-warning",
                error: "bg-destructive/20 text-destructive",
                success: "bg-success/20 text-success"
              };
  const cls = map[status] ?? "bg-muted text-muted-foreground";
  return (
    <span className={cn("inline-flex rounded-md px-2 py-0.5 text-xs font-medium capitalize", cls)}>
      {status.replace(/_/g, " ")}
    </span>
  );
}
