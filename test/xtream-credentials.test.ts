import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  XtreamCredentialService,
  type SafeStorageAdapter,
} from "../src/main/provider/credentials";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((path) => rm(path, { force: true, recursive: true })),
  );
});

describe("safeStorage credential import", () => {
  it("imports ignored plaintext once and subsequently reads only encrypted storage", async () => {
    const root = await mkdtemp(join(tmpdir(), "coax-credentials-"));
    temporaryDirectories.push(root);
    const applicationRoot = join(root, "application");
    const userData = join(root, "user-data");
    await mkdir(join(applicationRoot, "config", "local"), { recursive: true });
    await writeFile(
      join(applicationRoot, "config", "local", "xtream.json"),
      JSON.stringify({
        baseUrl: "https://provider.invalid/",
        password: "fixture-password",
        username: "fixture-user",
      }),
      "utf8",
    );
    const encryptString = vi.fn((value: string) =>
      Buffer.from(`safe:${Buffer.from(value).toString("base64")}`),
    );
    const storage: SafeStorageAdapter = {
      decryptString: (value) =>
        Buffer.from(value.toString().slice(5), "base64").toString("utf8"),
      encryptString,
      isEncryptionAvailable: () => true,
    };
    const service = new XtreamCredentialService(
      storage,
      applicationRoot,
      userData,
    );

    await expect(service.initialize()).resolves.toEqual({
      imported: true,
      status: "available",
    });
    const encrypted = await readFile(
      join(userData, "credentials", "xtream.safe"),
      "utf8",
    );
    expect(encrypted).not.toContain("fixture-user");
    await writeFile(
      join(applicationRoot, "config", "local", "xtream.json"),
      "not-json-anymore",
      "utf8",
    );
    await expect(service.initialize()).resolves.toEqual({
      imported: false,
      status: "available",
    });
    expect(encryptString).toHaveBeenCalledTimes(1);
    await expect(service.load()).resolves.toMatchObject({
      password: "fixture-password",
      username: "fixture-user",
    });
    await expect(service.loadName()).resolves.toBe("Development Xtream source");
  });

  it("does not fall back to plaintext when safeStorage is unavailable", async () => {
    const root = await mkdtemp(join(tmpdir(), "coax-credentials-"));
    temporaryDirectories.push(root);
    const applicationRoot = join(root, "application");
    await mkdir(join(applicationRoot, "config", "local"), { recursive: true });
    await writeFile(
      join(applicationRoot, "config", "local", "xtream.json"),
      JSON.stringify({
        baseUrl: "https://provider.invalid/",
        password: "fixture-password",
        username: "fixture-user",
      }),
      "utf8",
    );
    const service = new XtreamCredentialService(
      {
        decryptString: () => "",
        encryptString: () => Buffer.alloc(0),
        isEncryptionAvailable: () => false,
      },
      applicationRoot,
      join(root, "user-data"),
    );
    await expect(service.initialize()).rejects.toThrow(
      "safe-storage-unavailable",
    );
  });

  it("atomically replaces and removes the encrypted credential record", async () => {
    const root = await mkdtemp(join(tmpdir(), "coax-credentials-"));
    temporaryDirectories.push(root);
    let encryptionFails = false;
    const storage: SafeStorageAdapter = {
      decryptString: (value) =>
        Buffer.from(value.toString().slice(5), "base64").toString("utf8"),
      encryptString: (value) => {
        if (encryptionFails) throw new Error("encryption-failed");
        return Buffer.from(`safe:${Buffer.from(value).toString("base64")}`);
      },
      isEncryptionAvailable: () => true,
    };
    const service = new XtreamCredentialService(
      storage,
      join(root, "application"),
      join(root, "user-data"),
    );
    const original = {
      baseUrl: "https://provider.invalid/",
      outputFormats: ["ts"] as const,
      password: `private-${crypto.randomUUID()}`,
      playbackRequest: { headers: {} },
      providerRequest: { headers: {} },
      username: `account-${crypto.randomUUID()}`,
    };

    await service.replace(original, "Sports source");
    encryptionFails = true;
    await expect(
      service.replace({ ...original, username: "replacement-account" }),
    ).rejects.toThrow("xtream-credentials-storage-failed");
    encryptionFails = false;
    await expect(service.load()).resolves.toEqual(original);
    await expect(service.loadName()).resolves.toBe("Sports source");

    await service.remove();
    await expect(service.load()).rejects.toThrow("xtream-credentials-missing");
  });
});
