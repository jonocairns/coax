import { cn } from "@/lib/utils";

export function StatusIndicator({
  children,
  className,
  tone = "default",
}: {
  children: React.ReactNode;
  className?: string;
  tone?: "default" | "warning" | "destructive" | "success";
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 text-xs text-muted-foreground",
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cn("size-1.5 shrink-0 rounded-full bg-brand", {
          "bg-destructive": tone === "destructive",
          "bg-success": tone === "success",
          "bg-warning": tone === "warning",
        })}
      />
      {children}
    </span>
  );
}
