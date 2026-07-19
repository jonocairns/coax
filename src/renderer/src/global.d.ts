import type { CoaxApi } from "../../shared/api";

declare global {
  interface Window {
    coax: CoaxApi;
  }
}

export {};
