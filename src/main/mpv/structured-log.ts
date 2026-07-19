import { randomBytes } from "node:crypto";
import { mkdir, appendFile } from "node:fs/promises";
import { join } from "node:path";

const SENSITIVE_KEY =
  /(authorization|cookie|credential|header|password|pipe|secret|stream.?url|token|username)/i;
const URL_PATTERN = /\b(?:https?|rtmps?|rtsp):\/\/[^\s"']+/gi;
const PIPE_PATTERN = /\\\\\.\\pipe\\[^\s"']+/gi;
const CREDENTIAL_PATTERN =
  /\b(authorization|cookie|password|secret|token|username)\s*[:=]\s*[^\s,;]+/gi;

export type StructuredLogValue = string | number | boolean | null;

export interface StructuredLogRecord {
  timestamp: string;
  elapsedMs: number;
  sessionId: string;
  generation: number;
  event: string;
  [key: string]: StructuredLogValue;
}

export function redactSensitiveText(value: string): string {
  return value
    .replace(URL_PATTERN, "[redacted-url]")
    .replace(PIPE_PATTERN, "[redacted-pipe]")
    .replace(CREDENTIAL_PATTERN, "$1=[redacted]");
}

export function sanitizeLogDetails(
  details: Readonly<Record<string, StructuredLogValue>>,
): Record<string, StructuredLogValue> {
  return Object.fromEntries(
    Object.entries(details).map(([key, value]) => {
      if (SENSITIVE_KEY.test(key) && typeof value === "string") {
        return [key, "[redacted]"];
      }
      return [
        key,
        typeof value === "string" ? redactSensitiveText(value) : value,
      ];
    }),
  );
}

function createRunId(): string {
  const requested = process.env.COAX_M0_RUN_ID;
  if (requested && /^[a-z0-9][a-z0-9_-]{0,63}$/i.test(requested)) {
    return requested;
  }
  return `slice2-${new Date().toISOString().replace(/[:.]/g, "-")}-${randomBytes(4).toString("hex")}`;
}

export class StructuredPlaybackLogger {
  readonly runId: string;
  readonly sessionId = randomBytes(16).toString("hex");
  readonly filePath: string;
  private readonly startedAt = performance.now();
  private pending: Promise<void>;

  constructor(applicationRoot: string) {
    this.runId = createRunId();
    const directory = join(applicationRoot, "artifacts", "m0", this.runId);
    this.filePath = join(directory, "slice2-events.jsonl");
    this.pending = mkdir(directory, { recursive: true }).then(() => undefined);
  }

  write(
    event: string,
    generation: number,
    details: Readonly<Record<string, StructuredLogValue>> = {},
  ): void {
    const record: StructuredLogRecord = {
      timestamp: new Date().toISOString(),
      elapsedMs: Math.round((performance.now() - this.startedAt) * 10) / 10,
      sessionId: this.sessionId,
      generation,
      event: redactSensitiveText(event),
      ...sanitizeLogDetails(details),
    };
    const line = `${JSON.stringify(record)}\n`;
    this.pending = this.pending.then(() =>
      appendFile(this.filePath, line, "utf8"),
    );
  }

  async close(): Promise<void> {
    await this.pending;
  }
}
