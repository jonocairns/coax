import type { ProviderWorkerRequest, ProviderWorkerResponse } from "./protocol";
import {
  ProviderRequestError,
  refreshXtreamCatalog,
  resolveXtreamPlayback,
} from "./xtream";

function failure(id: number, error: unknown): ProviderWorkerResponse {
  if (error instanceof ProviderRequestError) {
    return {
      error: { code: error.code, kind: error.kind },
      id,
      ok: false,
    };
  }
  return {
    error: { code: "provider-worker-failure", kind: "provider-data" },
    id,
    ok: false,
  };
}

process.parentPort.on("message", (event) => {
  const request = event.data as ProviderWorkerRequest;
  void (async (): Promise<ProviderWorkerResponse> => {
    if (request.type === "refresh") {
      return {
        catalog: await refreshXtreamCatalog(request.credentials),
        id: request.id,
        ok: true,
        type: "refresh",
      };
    }
    return {
      id: request.id,
      ok: true,
      playback: resolveXtreamPlayback(request.credentials, request.channel),
      type: "resolve",
    };
  })().then(
    (response) => process.parentPort.postMessage(response),
    (error: unknown) =>
      process.parentPort.postMessage(failure(request.id, error)),
  );
});
