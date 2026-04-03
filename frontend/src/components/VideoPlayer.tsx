import { Film } from "lucide-react";
import { cn } from "../lib/utils";

export function VideoPlayer({ src, className }: { src?: string | null; className?: string }) {
  if (!src) {
    return (
      <div
        className={cn(
          "flex aspect-[9/16] max-h-[70vh] w-full max-w-sm items-center justify-center rounded-xl border border-dashed border-border bg-muted/30",
          className
        )}
      >
        <div className="flex flex-col items-center gap-2 text-muted-foreground">
          <Film className="h-10 w-10" />
          <span className="text-sm">Aucune vidéo</span>
        </div>
      </div>
    );
  }
  return (
    <video
      className={cn("aspect-[9/16] max-h-[70vh] w-full max-w-sm rounded-xl border border-border bg-black", className)}
      src={src}
      controls
      playsInline
    />
  );
}
