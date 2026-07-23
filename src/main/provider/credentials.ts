import { randomBytes } from "node:crypto";
import {
  mkdir,
  readFile,
  rename,
  rm,
  unlink,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  parseSourceDisplayName,
  parseXtreamDevelopmentInput,
  readXtreamDevelopmentInput,
  type XtreamCredentials,
} from "./config";

export interface SafeStorageAdapter {
  decryptString(value: Buffer): string;
  encryptString(value: string): Buffer;
  isEncryptionAvailable(): boolean;
}

export interface CredentialInitializationResult {
  imported: boolean;
  status: "available" | "missing";
}

export interface StoredXtreamSource {
  credentials: XtreamCredentials;
  name: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseStoredSource(value: string): StoredXtreamSource {
  const parsed: unknown = JSON.parse(value);
  if (
    isRecord(parsed) &&
    parsed.schemaVersion === 1 &&
    "credentials" in parsed
  ) {
    return {
      credentials: parseXtreamDevelopmentInput(
        JSON.stringify(parsed.credentials),
      ),
      name: parseSourceDisplayName(parsed.name),
    };
  }
  return {
    credentials: parseXtreamDevelopmentInput(value),
    name: "Xtream source",
  };
}

export class XtreamCredentialService {
  private readonly encryptedPath: string;

  constructor(
    private readonly storage: SafeStorageAdapter,
    private readonly applicationRoot: string,
    userDataPath: string,
  ) {
    this.encryptedPath = join(userDataPath, "credentials", "xtream.safe");
  }

  async initialize(): Promise<CredentialInitializationResult> {
    if (await this.encryptedCredentialsExist()) {
      await this.load();
      return { imported: false, status: "available" };
    }
    const developmentInput = await readXtreamDevelopmentInput(
      this.applicationRoot,
    );
    if (!developmentInput) return { imported: false, status: "missing" };
    if (!this.storage.isEncryptionAvailable()) {
      throw new Error("safe-storage-unavailable");
    }
    await this.persist(developmentInput, "Development Xtream source");
    return { imported: true, status: "available" };
  }

  async load(): Promise<XtreamCredentials> {
    return (await this.loadStoredSource()).credentials;
  }

  async loadName(): Promise<string> {
    return (await this.loadStoredSource()).name;
  }

  private async loadStoredSource(): Promise<StoredXtreamSource> {
    if (!this.storage.isEncryptionAvailable()) {
      throw new Error("safe-storage-unavailable");
    }
    let encrypted: Buffer;
    try {
      encrypted = await readFile(this.encryptedPath);
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        throw new Error("xtream-credentials-missing", { cause: error });
      }
      throw error;
    }
    try {
      return parseStoredSource(this.storage.decryptString(encrypted));
    } catch (error) {
      throw new Error("xtream-credentials-unreadable", { cause: error });
    }
  }

  async replace(
    credentials: XtreamCredentials,
    name = "Xtream source",
  ): Promise<void> {
    if (!this.storage.isEncryptionAvailable()) {
      throw new Error("safe-storage-unavailable");
    }
    try {
      await this.persist(credentials, name);
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === "safe-storage-unavailable"
      ) {
        throw error;
      }
      throw new Error("xtream-credentials-storage-failed", { cause: error });
    }
  }

  async remove(): Promise<void> {
    try {
      await unlink(this.encryptedPath);
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        return;
      }
      throw new Error("xtream-credentials-removal-failed", { cause: error });
    }
  }

  private async encryptedCredentialsExist(): Promise<boolean> {
    try {
      await readFile(this.encryptedPath);
      return true;
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        return false;
      }
      throw error;
    }
  }

  private async persist(
    credentials: XtreamCredentials,
    name: string,
  ): Promise<void> {
    if (!this.storage.isEncryptionAvailable()) {
      throw new Error("safe-storage-unavailable");
    }
    const encrypted = this.storage.encryptString(
      JSON.stringify({
        credentials,
        name: parseSourceDisplayName(name),
        schemaVersion: 1,
      }),
    );
    const directory = dirname(this.encryptedPath);
    await mkdir(directory, { mode: 0o700, recursive: true });
    const temporaryPath = `${this.encryptedPath}.${randomBytes(8).toString("hex")}.tmp`;
    try {
      await writeFile(temporaryPath, encrypted, { flag: "wx", mode: 0o600 });
      await rename(temporaryPath, this.encryptedPath);
    } finally {
      await rm(temporaryPath, { force: true });
    }
  }
}
