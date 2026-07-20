import { describe, expect, it } from "vitest";
import {
  redactSensitiveText,
  sanitizeLogDetails,
} from "../src/main/mpv/structured-log";

describe("playback log redaction", () => {
  it("removes authenticated URLs, credentials, cookies, and pipe names", () => {
    const privateUrl =
      "https://alice:password@example.invalid/live.m3u8?token=secret";
    const value = redactSensitiveText(
      `failed ${privateUrl} Authorization=Bearer-secret Cookie=session-secret \\\\.\\pipe\\coax-private`,
    );

    expect(value).not.toContain(privateUrl);
    expect(value).not.toContain("Bearer-secret");
    expect(value).not.toContain("session-secret");
    expect(value).not.toContain("coax-private");
  });

  it("redacts sensitive structured fields before serialization", () => {
    const details = sanitizeLogDetails({
      streamUrl: "https://example.invalid/private",
      cookieHeader: "session=secret",
      pipeReachable: false,
      reason: "network error at https://example.invalid/private?key=secret",
      transport: "https",
    });
    const serialized = JSON.stringify(details);

    expect(details.transport).toBe("https");
    expect(details.pipeReachable).toBe(false);
    expect(serialized).not.toContain("example.invalid");
    expect(serialized).not.toContain("session=secret");
  });

  it("keeps provider success/failure records structural without payload shortcuts", () => {
    const serialized = JSON.stringify(
      sanitizeLogDetails({
        authenticatedUrl:
          "https://fixture-user:fixture-password@provider.invalid/live.ts",
        cookie: "session=fixture-cookie",
        failureKind: "authentication",
        headers: "Authorization: fixture-token",
        reason: "provider-authentication-rejected",
      }),
    );

    expect(serialized).toContain("provider-authentication-rejected");
    expect(serialized).toContain("authentication");
    expect(serialized).not.toContain("fixture-user");
    expect(serialized).not.toContain("fixture-password");
    expect(serialized).not.toContain("fixture-cookie");
    expect(serialized).not.toContain("fixture-token");
    expect(serialized).not.toContain("provider.invalid");
  });
});
