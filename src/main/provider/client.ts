import { utilityProcess, type UtilityProcess } from "electron";
import type { XtreamCredentials } from "./config";
import type {
  ProviderWorkerRequest,
  ProviderWorkerResponse,
  ResolvedProviderPlayback,
  TrustedProviderCatalog,
  TrustedProviderChannel,
} from "./protocol";
import { ProviderRequestError } from "./xtream";

interface PendingRequest {
  reject: (error: Error) => void;
  resolve: (response: ProviderWorkerResponse) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class XtreamUtilityClient {
  private readonly child: UtilityProcess;
  private nextId = 0;
  private readonly pending = new Map<number, PendingRequest>();

  constructor(workerPath: string) {
    this.child = utilityProcess.fork(workerPath, [], {
      serviceName: "Coax Xtream data",
      stdio: "ignore",
    });
    this.child.on("message", (message: unknown) => this.handleMessage(message));
    this.child.once("exit", () => {
      for (const request of this.pending.values()) {
        clearTimeout(request.timer);
        request.reject(new Error("provider-utility-exited"));
      }
      this.pending.clear();
    });
  }

  async refresh(
    credentials: XtreamCredentials,
  ): Promise<TrustedProviderCatalog> {
    const response = await this.request({
      credentials,
      id: ++this.nextId,
      type: "refresh",
    });
    if (!response.ok) {
      throw new ProviderRequestError(response.error.kind, response.error.code);
    }
    if (response.type !== "refresh")
      throw new Error("provider-response-mismatch");
    return response.catalog;
  }

  async resolve(
    credentials: XtreamCredentials,
    channel: TrustedProviderChannel,
  ): Promise<ResolvedProviderPlayback> {
    const response = await this.request({
      channel,
      credentials,
      id: ++this.nextId,
      type: "resolve",
    });
    if (!response.ok) {
      throw new ProviderRequestError(response.error.kind, response.error.code);
    }
    if (response.type !== "resolve")
      throw new Error("provider-response-mismatch");
    return response.playback;
  }

  close(): void {
    this.child.kill();
  }

  private request(
    request: ProviderWorkerRequest,
  ): Promise<ProviderWorkerResponse> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(request.id);
        reject(new Error("provider-utility-timeout"));
      }, 20_000);
      this.pending.set(request.id, { reject, resolve, timer });
      this.child.postMessage(request);
    });
  }

  private handleMessage(message: unknown): void {
    if (
      typeof message !== "object" ||
      message === null ||
      !("id" in message) ||
      typeof message.id !== "number"
    ) {
      return;
    }
    const request = this.pending.get(message.id);
    if (!request) return;
    this.pending.delete(message.id);
    clearTimeout(request.timer);
    request.resolve(message as ProviderWorkerResponse);
  }
}
