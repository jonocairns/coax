export type JsonLineResult =
  | { ok: true; value: unknown }
  | { ok: false; reason: "invalid-json" | "line-too-long" };

const MAX_LINE_LENGTH = 1024 * 1024;

export class JsonLineParser {
  private buffer = "";

  push(chunk: string): JsonLineResult[] {
    this.buffer += chunk;
    if (this.buffer.length > MAX_LINE_LENGTH && !this.buffer.includes("\n")) {
      this.buffer = "";
      return [{ ok: false, reason: "line-too-long" }];
    }

    const lines = this.buffer.split("\n");
    this.buffer = lines.pop() ?? "";
    const results: JsonLineResult[] = [];

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.length === 0) continue;
      if (trimmed.length > MAX_LINE_LENGTH) {
        results.push({ ok: false, reason: "line-too-long" });
        continue;
      }
      try {
        results.push({ ok: true, value: JSON.parse(trimmed) as unknown });
      } catch {
        results.push({ ok: false, reason: "invalid-json" });
      }
    }

    return results;
  }
}
