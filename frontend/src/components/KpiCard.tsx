import type { LucideIcon } from "lucide-react";
import { Card } from "./ui/card";
import { cn } from "../lib/utils";

export function KpiCard({
  title,
  value,
  icon: Icon,
  variant = "default"
}: {
  title: string;
  value: string | number;
  icon: LucideIcon;
  variant?: "default" | "gold" | "accent";
}) {
  return (
    <Card
      className={cn(
        "animate-fade-in",
        variant === "gold" && "animate-pulse-gold border-primary/30",
        variant === "accent" && "border-accent/40"
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{title}</p>
          <p className="mt-1 text-2xl font-bold text-foreground">{value}</p>
        </div>
        <div
          className={cn(
            "flex h-10 w-10 items-center justify-center rounded-lg bg-muted",
            variant === "gold" && "gradient-gold text-primary-foreground",
            variant === "accent" && "bg-accent/20 text-accent"
          )}
        >
          <Icon className="h-5 w-5" />
        </div>
      </div>
    </Card>
  );
}
