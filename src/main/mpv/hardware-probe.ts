import { spawn } from "node:child_process";
import { parseD3d11Adapters, type D3d11Adapter } from "./hardware-profile";

const PROBE_TIMEOUT_MS = 5_000;
const MAX_PROBE_OUTPUT_BYTES = 64 * 1024;

export async function enumerateD3d11Adapters(
  executablePath: string,
): Promise<readonly D3d11Adapter[]> {
  const output = await new Promise<string>((resolve, reject) => {
    const child = spawn(
      executablePath,
      [
        "--no-config",
        "--terminal=yes",
        "--msg-level=all=info",
        "--vo=gpu-next",
        "--gpu-api=d3d11",
        "--gpu-context=d3d11",
        "--d3d11-adapter=help",
        "--idle=no",
      ],
      {
        shell: false,
        windowsHide: true,
      },
    );
    let settled = false;
    let captured = "";
    const finish = (error?: Error): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(captured);
    };
    const append = (chunk: Buffer): void => {
      if (Buffer.byteLength(captured, "utf8") >= MAX_PROBE_OUTPUT_BYTES) return;
      captured += chunk.toString("utf8");
      if (Buffer.byteLength(captured, "utf8") > MAX_PROBE_OUTPUT_BYTES) {
        captured = captured.slice(0, MAX_PROBE_OUTPUT_BYTES);
      }
    };
    child.stdout?.on("data", append);
    child.stderr?.on("data", append);
    child.once("error", (error) => finish(error));
    child.once("exit", (code) => {
      if (code !== 0) finish(new Error("mpv-adapter-probe-failed"));
      else finish();
    });
    const timer = setTimeout(() => {
      child.kill();
      finish(new Error("mpv-adapter-probe-timeout"));
    }, PROBE_TIMEOUT_MS);
  });
  const adapters = parseD3d11Adapters(output);
  if (adapters.length === 0) throw new Error("mpv-d3d11-adapters-unavailable");
  return adapters;
}
