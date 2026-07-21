import { randomBytes } from "node:crypto";
import { appendFile, mkdir, rename, rm, stat } from "node:fs/promises";
import { join } from "node:path";

const SENSITIVE_KEY =
  /(authorization|cookie|credential|header|password|pipe|raw.*output|secret|stream.?url|token|username)/i;
const URL_PATTERN = /\b(?:https?|rtmps?|rtsp):\/\/[^\s"']+/gi;
const PIPE_PATTERN = /\\\\\.\\pipe\\[^\s"']+/gi;
const CREDENTIAL_PATTERN =
  /\b(authorization|cookie|password|proxy-authorization|secret|token|username|(?:api|access)[_-]?key)\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\r\n,;]+)/gi;

export const STRUCTURED_LOG_MAX_BYTES = 2 * 1024 * 1024;
export const STRUCTURED_LOG_RETAINED_FILES = 4;
const MAX_LOG_TEXT_LENGTH = 4 * 1024;

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
    .replace(CREDENTIAL_PATTERN, "$1=[redacted]")
    .slice(0, MAX_LOG_TEXT_LENGTH);
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
  return `slice5-${new Date().toISOString().replace(/[:.]/g, "-")}-${randomBytes(4).toString("hex")}`;
}

export class StructuredPlaybackLogger {
  readonly runId: string;
  readonly sessionId: string;
  readonly filePath: string;
  private readonly startedAt = performance.now();
  private currentBytes = 0;
  private pending: Promise<void>;

  constructor(
    applicationRoot: string,
    private readonly maxBytes = STRUCTURED_LOG_MAX_BYTES,
    private readonly retainedFiles = STRUCTURED_LOG_RETAINED_FILES,
  ) {
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 512) {
      throw new Error("invalid-structured-log-max-bytes");
    }
    if (!Number.isSafeInteger(retainedFiles) || retainedFiles < 1) {
      throw new Error("invalid-structured-log-retention");
    }
    this.runId = createRunId();
    this.sessionId = randomBytes(16).toString("hex");
    const directory = join(applicationRoot, "artifacts", "m0", this.runId);
    this.filePath = join(directory, "playback-events.jsonl");
    this.pending = mkdir(directory, { recursive: true })
      .then(async () => {
        try {
          this.currentBytes = (await stat(this.filePath)).size;
        } catch (error) {
          if (
            typeof error !== "object" ||
            error === null ||
            !("code" in error) ||
            error.code !== "ENOENT"
          ) {
            throw error;
          }
        }
      })
      .then(() => undefined);
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
    let line = `${JSON.stringify(record)}\n`;
    if (Buffer.byteLength(line, "utf8") > this.maxBytes) {
      line = `${JSON.stringify({
        timestamp: record.timestamp,
        elapsedMs: record.elapsedMs,
        sessionId: record.sessionId,
        generation: record.generation,
        event: "structured-log-record-oversize",
        reason: "bounded-record-replaced",
      })}\n`;
    }
    this.pending = this.pending.then(() => this.appendBounded(line));
  }

  private async appendBounded(line: string): Promise<void> {
    const lineBytes = Buffer.byteLength(line, "utf8");
    if (
      this.currentBytes > 0 &&
      this.currentBytes + lineBytes > this.maxBytes
    ) {
      for (let index = this.retainedFiles - 1; index >= 1; index -= 1) {
        const target = `${this.filePath}.${index}`;
        await rm(target, { force: true });
        const source =
          index === 1 ? this.filePath : `${this.filePath}.${index - 1}`;
        try {
          await rename(source, target);
        } catch (error) {
          if (
            typeof error !== "object" ||
            error === null ||
            !("code" in error) ||
            error.code !== "ENOENT"
          ) {
            throw error;
          }
        }
      }
      this.currentBytes = 0;
    }
    await appendFile(this.filePath, line, "utf8");
    this.currentBytes += lineBytes;
  }

  async close(): Promise<void> {
    await this.pending;
  }
}
