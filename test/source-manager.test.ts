import { describe, expect, it, vi } from "vitest";
import type { ProviderViewState } from "../src/shared/provider";
import type { XtreamCredentials } from "../src/main/provider/config";
import type { TrustedProviderCatalog } from "../src/main/provider/protocol";
import {
  SourceMutationError,
  XtreamSourceManager,
} from "../src/main/provider/source-manager";
import { ProviderRequestError } from "../src/main/provider/xtream";

function catalog(name: string): TrustedProviderCatalog {
  return {
    categories: [{ id: "xtc_111111111111111111111111", name: "Live" }],
    channels: [
      {
        categoryId: "xtc_111111111111111111111111",
        format: "ts",
        id: "xch_111111111111111111111111",
        name,
        streamId: "101",
      },
    ],
    counts: {
      categoriesNormalized: 1,
      categoriesSkipped: 0,
      channelsNormalized: 1,
      channelsSkipped: 0,
      playbackVariants: 1,
    },
    viewChannels: [
      {
        categoryId: "xtc_111111111111111111111111",
        id: "xch_111111111111111111111111",
        name,
        transport: "mpeg-ts",
      },
    ],
  };
}

function submittedInput() {
  return {
    name: "Fixture source",
    outputPreference: "ts" as const,
    password: `private-${crypto.randomUUID()}`,
    serverUrl: "https://provider.invalid/root",
    username: `account-${crypto.randomUUID()}`,
  };
}

function readyState(
  value: TrustedProviderCatalog,
  sourceName = "Fixture source",
): ProviderViewState {
  return {
    categories: value.categories,
    channels: value.viewChannels,
    counts: value.counts,
    phase: "ready",
    source: { name: sourceName, type: "xtream" },
  };
}

describe("single Xtream source mutations", () => {
  it("takes clean first-run setup through validation and persistence to ready channels", async () => {
    const events: string[] = [];
    const candidate = catalog("First-run channel");
    const replace = vi.fn(
      async (credentials: XtreamCredentials, sourceName: string) => {
        void credentials;
        void sourceName;
        events.push("persist");
      },
    );
    const sessionReplace = vi.fn(
      (
        credentials: XtreamCredentials,
        value: TrustedProviderCatalog,
        sourceName: string,
      ) => {
        void credentials;
        events.push("activate");
        return readyState(value, sourceName);
      },
    );
    const input = submittedInput();
    const manager = new XtreamSourceManager(
      { remove: vi.fn(), replace },
      {
        refresh: async () => {
          events.push("validate");
          return candidate;
        },
      },
      { clear: vi.fn(), replace: sessionReplace },
    );

    const state = await manager.configure(input);

    expect(events).toEqual(["validate", "persist", "activate"]);
    expect(state).toMatchObject({
      channels: [{ name: "First-run channel" }],
      phase: "ready",
      source: { name: input.name },
    });
    expect(replace).toHaveBeenCalledWith(expect.any(Object), input.name);
    expect(JSON.stringify(state)).not.toMatch(/account-|private-/);
  });

  it("rejects malformed input before provider or storage access", async () => {
    const refresh = vi.fn();
    const replace = vi.fn();
    const manager = new XtreamSourceManager(
      { remove: vi.fn(), replace },
      { refresh },
      { clear: vi.fn(), replace: vi.fn() },
    );

    await expect(
      manager.configure({
        name: "",
        outputPreference: "ts",
        password: "",
        serverUrl: "file:///private",
        username: "",
      }),
    ).rejects.toMatchObject({
      code: "invalid-source-server-url",
      kind: "validation",
    });
    expect(refresh).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
  });

  it("keeps the working source when authentication or catalog validation fails", async () => {
    const working = catalog("Working channel");
    let active = readyState(working);
    const storeReplace = vi.fn();
    const sessionReplace = vi.fn(
      (_credentials: XtreamCredentials, value: TrustedProviderCatalog) => {
        active = readyState(value);
        return active;
      },
    );
    const failure = vi
      .fn()
      .mockRejectedValueOnce(
        new ProviderRequestError(
          "authentication",
          "provider-authentication-rejected",
        ),
      )
      .mockRejectedValueOnce(
        new ProviderRequestError(
          "provider-data",
          "provider-live-shape-invalid",
        ),
      );
    const manager = new XtreamSourceManager(
      { remove: vi.fn(), replace: storeReplace },
      { refresh: failure },
      { clear: vi.fn(), replace: sessionReplace },
    );
    const input = submittedInput();

    await expect(manager.configure(input)).rejects.toMatchObject({
      code: "provider-authentication-rejected",
      kind: "authentication",
    });
    await expect(manager.configure(input)).rejects.toMatchObject({
      code: "provider-live-shape-invalid",
      kind: "provider-data",
    });
    expect(storeReplace).not.toHaveBeenCalled();
    expect(sessionReplace).not.toHaveBeenCalled();
    expect(active).toEqual(readyState(working));
  });

  it("does not activate a candidate when secure persistence fails", async () => {
    const input = submittedInput();
    const sessionReplace = vi.fn();
    const manager = new XtreamSourceManager(
      {
        remove: vi.fn(),
        replace: vi
          .fn()
          .mockRejectedValue(new Error("safe-storage-unavailable")),
      },
      { refresh: async () => catalog("Candidate channel") },
      { clear: vi.fn(), replace: sessionReplace },
    );

    const failure = await manager.configure(input).catch((error: unknown) => {
      expect(error).toBeInstanceOf(SourceMutationError);
      return error as SourceMutationError;
    });
    expect(failure).toMatchObject({
      code: "safe-storage-unavailable",
      kind: "storage",
    });
    expect(JSON.stringify(failure)).not.toContain(input.username);
    expect(JSON.stringify(failure)).not.toContain(input.password);
    expect(sessionReplace).not.toHaveBeenCalled();
  });

  it("atomically activates a refreshed catalog after successful persistence", async () => {
    const oldCatalog = catalog("Old channel");
    const newCatalog = catalog("Refreshed channel");
    let active = readyState(oldCatalog);
    const manager = new XtreamSourceManager(
      { remove: vi.fn(), replace: vi.fn() },
      { refresh: async () => newCatalog },
      {
        clear: vi.fn(),
        replace: (_credentials, value) => {
          active = readyState(value);
          return active;
        },
      },
    );

    await expect(manager.configure(submittedInput())).resolves.toMatchObject({
      channels: [{ name: "Refreshed channel" }],
      phase: "ready",
    });
    expect(active).toMatchObject({
      channels: [{ name: "Refreshed channel" }],
    });
  });

  it("deletes credentials before clearing the active source", async () => {
    const events: string[] = [];
    const manager = new XtreamSourceManager(
      {
        remove: async () => {
          events.push("remove-record");
        },
        replace: vi.fn(),
      },
      { refresh: vi.fn() },
      {
        clear: () => events.push("clear-session"),
        replace: vi.fn(),
      },
    );

    await manager.remove();
    expect(events).toEqual(["remove-record", "clear-session"]);
  });
});
