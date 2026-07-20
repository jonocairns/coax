import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
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
    await this.persist(developmentInput);
    return { imported: true, status: "available" };
  }

  async load(): Promise<XtreamCredentials> {
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
      return parseXtreamDevelopmentInput(this.storage.decryptString(encrypted));
    } catch (error) {
      throw new Error("xtream-credentials-unreadable", { cause: error });
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

  private async persist(credentials: XtreamCredentials): Promise<void> {
    const encrypted = this.storage.encryptString(JSON.stringify(credentials));
    const directory = dirname(this.encryptedPath);
    await mkdir(directory, { mode: 0o700, recursive: true });
    const temporaryPath = `${this.encryptedPath}.${randomBytes(8).toString("hex")}.tmp`;
    await writeFile(temporaryPath, encrypted, { flag: "wx", mode: 0o600 });
    await rename(temporaryPath, this.encryptedPath);
  }
}
