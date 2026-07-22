import { Copy, Minus, Square, X } from "lucide-react";
import type { WindowState } from "../../../shared/api";

interface TitleBarProps {
  state: WindowState;
}

export function TitleBar({ state }: TitleBarProps): React.JSX.Element | null {
  if (state.fullscreen) return null;

  return (
    <header className="title-bar flex h-11 shrink-0 items-center bg-titlebar text-titlebar-foreground select-none">
      <div className="flex min-w-0 flex-1 items-center px-4">
        <span className="font-brand truncate text-sm font-semibold tracking-[0.025em] text-titlebar-foreground/90">
          coax
        </span>
      </div>
      <div
        className="title-bar-controls flex h-full"
        aria-label="Window controls"
      >
        <button
          aria-label="Minimize"
          className="grid h-full w-12 place-items-center text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:z-10 focus-visible:outline-2 focus-visible:-outline-offset-2"
          onClick={() => void window.coax.windowControl("minimize")}
          title="Minimize"
          type="button"
        >
          <Minus className="size-4" strokeWidth={1.7} />
        </button>
        <button
          aria-label={state.maximized ? "Restore" : "Maximize"}
          className="grid h-full w-12 place-items-center text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:z-10 focus-visible:outline-2 focus-visible:-outline-offset-2"
          onClick={() => void window.coax.windowControl("toggle-maximize")}
          title={state.maximized ? "Restore" : "Maximize"}
          type="button"
        >
          {state.maximized ? (
            <Copy className="size-3.5 rotate-180" strokeWidth={1.5} />
          ) : (
            <Square className="size-3.5" strokeWidth={1.5} />
          )}
        </button>
        <button
          aria-label="Close"
          className="grid h-full w-12 place-items-center text-muted-foreground transition-colors hover:bg-red-600 hover:text-white focus-visible:z-10 focus-visible:outline-2 focus-visible:-outline-offset-2"
          onClick={() => void window.coax.windowControl("close")}
          title="Close"
          type="button"
        >
          <X className="size-4" strokeWidth={1.7} />
        </button>
      </div>
    </header>
  );
}
