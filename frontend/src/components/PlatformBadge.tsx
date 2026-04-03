import { cn } from "../lib/utils";

export function PlatformBadge({ platform }: { platform: string }) {
  const isIg = platform === "instagram";
  return (
    <span
      className={cn(
        "inline-flex rounded-md px-2 py-0.5 text-xs font-semibold",
        isIg ? "bg-pink-500/20 text-pink-300" : "bg-cyan-500/20 text-cyan-300"
      )}
    >
      {platform}
    </span>
  );
}
