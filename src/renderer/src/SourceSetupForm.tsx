import { useState } from "react";
import { Cable, ChevronDown } from "lucide-react";
import type { SourceMutationResult } from "../../shared/provider";
import { Button } from "./components/ui/button";
import { Input } from "./components/ui/input";

interface SourceSetupFormProps {
  mode?: "connect" | "replace";
  onCancel?: () => void;
  onSaved?: () => void;
}

type SetupStatus =
  | { phase: "idle"; message: string }
  | { phase: "submitting"; message: string }
  | { phase: "error"; message: string };

export function SourceSetupForm({
  mode = "connect",
  onCancel,
  onSaved,
}: SourceSetupFormProps): React.JSX.Element {
  const [status, setStatus] = useState<SetupStatus>({
    message:
      mode === "replace"
        ? "Your current source stays active until the replacement is validated."
        : "Your account details are tested before anything is saved.",
    phase: "idle",
  });

  async function submit(
    event: React.FormEvent<HTMLFormElement>,
  ): Promise<void> {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setStatus({
      message: "Testing the account and loading channels…",
      phase: "submitting",
    });

    let result: SourceMutationResult;
    try {
      result = await window.coax.configureXtreamSource({
        name: String(data.get("name") ?? ""),
        outputPreference: data.get("outputPreference") === "hls" ? "hls" : "ts",
        password: String(data.get("password") ?? ""),
        serverUrl: String(data.get("serverUrl") ?? ""),
        username: String(data.get("username") ?? ""),
      });
    } catch {
      result = {
        error: {
          code: "source-operation-unavailable",
          kind: "replacement",
          message: "Source setup is temporarily unavailable.",
        },
        ok: false,
      };
    } finally {
      const password = form.elements.namedItem("password");
      if (password instanceof HTMLInputElement) password.value = "";
    }

    if (result.ok) onSaved?.();
    else setStatus({ message: result.error.message, phase: "error" });
  }

  return (
    <form
      className="mx-auto w-full max-w-xl text-left"
      noValidate
      onSubmit={(event) => void submit(event)}
    >
      <div className="text-center">
        <span className="mx-auto grid size-14 place-items-center rounded-2xl border bg-card text-brand">
          <Cable />
        </span>
        <h2 className="mt-4 mb-2 text-2xl font-semibold">
          {mode === "replace"
            ? "Replace your TV source"
            : "Connect your TV provider"}
        </h2>
        <p className="text-muted-foreground">
          {mode === "replace"
            ? "Enter the complete details for the replacement Xtream source."
            : "Enter the Xtream account details supplied by your provider."}
        </p>
      </div>

      <div className="mt-7 grid gap-4">
        <label className="grid gap-2 text-sm font-medium">
          Source name
          <Input
            autoComplete="off"
            maxLength={80}
            name="name"
            placeholder="My TV"
            required
            spellCheck={false}
            type="text"
          />
        </label>
        <label className="grid gap-2 text-sm font-medium">
          Server URL
          <Input
            autoComplete="off"
            inputMode="url"
            name="serverUrl"
            placeholder="https://provider.example"
            required
            spellCheck={false}
            type="url"
          />
        </label>
        <label className="grid gap-2 text-sm font-medium">
          Username
          <Input
            autoComplete="off"
            name="username"
            required
            spellCheck={false}
            type="text"
          />
        </label>
        <label className="grid gap-2 text-sm font-medium">
          Password
          <Input
            autoComplete="off"
            name="password"
            required
            spellCheck={false}
            type="password"
          />
        </label>
      </div>

      <details className="mt-5 rounded-lg border bg-background/45">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
          Advanced
          <ChevronDown className="size-4 text-muted-foreground" />
        </summary>
        <label className="grid gap-2 border-t px-4 py-4 text-sm font-medium">
          Preferred live output
          <select
            className="h-10 rounded-md border border-input bg-input/20 px-3 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
            defaultValue="ts"
            name="outputPreference"
          >
            <option value="ts">MPEG-TS (recommended)</option>
            <option value="hls">HLS</option>
          </select>
        </label>
      </details>

      <p
        aria-live="polite"
        className={
          status.phase === "error"
            ? "mt-5 text-sm text-destructive"
            : "mt-5 text-sm text-muted-foreground"
        }
        role={status.phase === "error" ? "alert" : "status"}
      >
        {status.message}
      </p>

      <div className="mt-5 flex flex-wrap justify-end gap-2">
        {onCancel && (
          <Button
            disabled={status.phase === "submitting"}
            onClick={onCancel}
            type="button"
            variant="ghost"
          >
            Cancel
          </Button>
        )}
        <Button disabled={status.phase === "submitting"} type="submit">
          {status.phase === "submitting"
            ? "Testing…"
            : mode === "replace"
              ? "Test and replace"
              : "Test and save"}
        </Button>
      </div>
    </form>
  );
}
