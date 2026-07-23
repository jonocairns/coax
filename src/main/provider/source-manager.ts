import type {
  ProviderViewState,
  SourceMutationFailureKind,
} from "../../shared/provider";
import { parseXtreamSourceSetupInput, type XtreamCredentials } from "./config";
import type { TrustedProviderCatalog } from "./protocol";
import { ProviderRequestError } from "./xtream";

export interface MutableCredentialStore {
  remove(): Promise<void>;
  replace(credentials: XtreamCredentials, name: string): Promise<void>;
}

export interface CandidateProvider {
  refresh(credentials: XtreamCredentials): Promise<TrustedProviderCatalog>;
}

export interface MutableProviderSession {
  clear(): void;
  replace(
    credentials: XtreamCredentials,
    catalog: TrustedProviderCatalog,
    sourceName: string,
  ): ProviderViewState;
}

export class SourceMutationError extends Error {
  constructor(
    readonly kind: SourceMutationFailureKind,
    readonly code: string,
  ) {
    super(code);
    this.name = "SourceMutationError";
  }
}

function configurationFailure(error: unknown): SourceMutationError {
  if (error instanceof ProviderRequestError) {
    const kind = error.kind === "configuration" ? "validation" : error.kind;
    return new SourceMutationError(kind, error.code);
  }
  if (
    error instanceof Error &&
    /^invalid-(?:source|xtream)-[a-z0-9-]+$/.test(error.message)
  ) {
    return new SourceMutationError("validation", error.message);
  }
  return new SourceMutationError("provider-data", "provider-validation-failed");
}

export class XtreamSourceManager {
  private mutationTail: Promise<void> = Promise.resolve();

  constructor(
    private readonly credentials: MutableCredentialStore,
    private readonly provider: CandidateProvider,
    private readonly session: MutableProviderSession,
  ) {}

  configure(input: unknown): Promise<ProviderViewState> {
    return this.exclusive(async () => {
      let candidate: {
        credentials: XtreamCredentials;
        name: string;
      };
      try {
        candidate = parseXtreamSourceSetupInput(input);
      } catch (error) {
        throw configurationFailure(error);
      }

      let catalog: TrustedProviderCatalog;
      try {
        catalog = await this.provider.refresh(candidate.credentials);
      } catch (error) {
        throw configurationFailure(error);
      }

      try {
        await this.credentials.replace(candidate.credentials, candidate.name);
      } catch (error) {
        const code =
          error instanceof Error && error.message === "safe-storage-unavailable"
            ? "safe-storage-unavailable"
            : "source-storage-failed";
        throw new SourceMutationError("storage", code);
      }

      return this.session.replace(
        candidate.credentials,
        catalog,
        candidate.name,
      );
    });
  }

  remove(): Promise<void> {
    return this.exclusive(async () => {
      try {
        await this.credentials.remove();
      } catch {
        throw new SourceMutationError("storage", "source-removal-failed");
      }
      this.session.clear();
    });
  }

  private exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.mutationTail.then(operation, operation);
    this.mutationTail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}
