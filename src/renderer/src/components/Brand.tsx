import { cn } from "@/lib/utils";

export function Brand({ className }: { className?: string }) {
  return (
    <div
      aria-label="Coax"
      className={cn(
        "inline-flex items-center gap-2.5 text-[1.08rem] font-bold tracking-[-0.03em] text-foreground",
        className,
      )}
    >
      <span
        aria-hidden="true"
        className="relative size-6.5 rounded-full border-[0.15rem] border-foreground/85 after:absolute after:top-1/2 after:-right-1 after:h-1.5 after:w-2.5 after:-translate-y-1/2 after:rounded-full after:bg-background after:content-['']"
      />
      <span>coax</span>
    </div>
  );
}
