import { useEffect, useState } from "react";
import type { RuntimeVersions } from "../../shared/api";

export function App(): React.JSX.Element {
  const [versions, setVersions] = useState<RuntimeVersions | null>(null);
  const [testChannel, setTestChannel] = useState<string>("Playlist channel");

  useEffect(() => {
    void window.coax.getRuntimeVersions().then(setVersions);
  }, []);

  async function cycleChannel(direction: "next" | "previous"): Promise<void> {
    try {
      await window.coax.cycleTestChannel(direction);
      setTestChannel(
        direction === "next"
          ? "Next playlist channel requested"
          : "Previous playlist channel requested",
      );
    } catch {
      setTestChannel("Test stream switch unavailable");
    }
  }

  return (
    <main>
      <p className="eyebrow">M0a · Slice 2</p>
      <h1>Coax</h1>
      <p>Electron shell ready. Native playback opens in mpv.</p>
      <section aria-label="Private test stream controls">
        <p>{testChannel}</p>
        <div className="controls">
          <button type="button" onClick={() => void cycleChannel("previous")}>
            Previous
          </button>
          <button type="button" onClick={() => void cycleChannel("next")}>
            Next
          </button>
        </div>
      </section>
      {versions ? (
        <dl aria-label="Runtime versions">
          <div>
            <dt>Electron</dt>
            <dd>{versions.electron}</dd>
          </div>
          <div>
            <dt>Node</dt>
            <dd>{versions.node}</dd>
          </div>
          <div>
            <dt>Chromium</dt>
            <dd>{versions.chrome}</dd>
          </div>
        </dl>
      ) : (
        <p>Reading runtime versions…</p>
      )}
    </main>
  );
}
