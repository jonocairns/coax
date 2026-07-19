import { useEffect, useState } from "react";
import type { RuntimeVersions } from "../../shared/api";

export function App(): React.JSX.Element {
  const [versions, setVersions] = useState<RuntimeVersions | null>(null);

  useEffect(() => {
    void window.coax.getRuntimeVersions().then(setVersions);
  }, []);

  return (
    <main>
      <p className="eyebrow">M0a · Slice 1</p>
      <h1>Coax</h1>
      <p>Repository foundation ready.</p>
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
