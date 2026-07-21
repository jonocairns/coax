import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import {
  appendFile,
  mkdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:http";
import { join, resolve } from "node:path";

const CONTRACT_VERSION = "coax-clean-stream-v1";
const LOG_MAX_BYTES = 1024 * 1024;
const LOG_RETAINED_FILES = 4;

function parseArguments(arguments_) {
  const options = { bind: "0.0.0.0", port: 48180, artifactDirectory: null };
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    const value = arguments_[index + 1];
    if (argument === "--bind" && value) options.bind = value;
    else if (argument === "--port" && value && /^\d{2,5}$/.test(value))
      options.port = Number(value);
    else if (argument === "--artifact-dir" && value)
      options.artifactDirectory = resolve(value);
    else throw new Error("invalid-slice8-server-arguments");
    index += 1;
  }
  if (!options.artifactDirectory || options.port > 65_535) {
    throw new Error("invalid-slice8-server-arguments");
  }
  return options;
}

class BoundedJsonl {
  constructor(path) {
    this.path = path;
    this.bytes = 0;
    this.pending = Promise.resolve();
  }

  write(event, details = {}) {
    const line = `${JSON.stringify({ timestamp: new Date().toISOString(), event, ...details })}\n`;
    this.pending = this.pending.then(async () => {
      const lineBytes = Buffer.byteLength(line);
      if (this.bytes > 0 && this.bytes + lineBytes > LOG_MAX_BYTES) {
        for (let index = LOG_RETAINED_FILES - 1; index >= 1; index -= 1) {
          const target = `${this.path}.${index}`;
          await rm(target, { force: true });
          const source = index === 1 ? this.path : `${this.path}.${index - 1}`;
          try {
            await rename(source, target);
          } catch (error) {
            if (error?.code !== "ENOENT") throw error;
          }
        }
        this.bytes = 0;
      }
      await appendFile(this.path, line, "utf8");
      this.bytes += lineBytes;
    });
  }

  close() {
    return this.pending;
  }
}

function ffmpegInputs() {
  return [
    "-hide_banner",
    "-loglevel",
    "warning",
    "-re",
    "-f",
    "lavfi",
    "-i",
    "testsrc2=size=640x360:rate=25",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=1000:sample_rate=48000",
    "-c:v",
    "libx264",
    "-preset",
    "ultrafast",
    "-tune",
    "zerolatency",
    "-pix_fmt",
    "yuv420p",
    "-g",
    "50",
    "-keyint_min",
    "50",
    "-sc_threshold",
    "0",
    "-c:a",
    "aac",
    "-b:a",
    "96k",
  ];
}

function startHlsGenerator(directory, keyInfoPath) {
  const arguments_ = [
    ...ffmpegInputs(),
    "-f",
    "hls",
    "-hls_time",
    "2",
    "-hls_list_size",
    "8",
    "-hls_flags",
    "delete_segments+omit_endlist+independent_segments+program_date_time+temp_file",
    "-hls_segment_filename",
    join(directory, "segment-%08d.ts"),
  ];
  if (keyInfoPath) arguments_.push("-hls_key_info_file", keyInfoPath);
  arguments_.push(join(directory, "index.m3u8"));
  return spawn("ffmpeg", arguments_, { stdio: ["ignore", "ignore", "ignore"] });
}

async function waitForPlaylist(path, child) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error("slice8-hls-generator-exited");
    try {
      const playlist = await readFile(path, "utf8");
      if (playlist.includes("#EXTINF:")) return;
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 200));
  }
  throw new Error("slice8-hls-generator-timeout");
}

function contentType(path) {
  if (path.endsWith(".m3u8")) return "application/vnd.apple.mpegurl";
  if (path.endsWith(".ts")) return "video/mp2t";
  return "application/octet-stream";
}

async function serveFile(response, path) {
  const metadata = await stat(path);
  response.writeHead(200, {
    "Cache-Control": "no-store",
    "Content-Length": metadata.size,
    "Content-Type": contentType(path),
  });
  createReadStream(path).pipe(response);
}

const options = parseArguments(process.argv.slice(2));
await mkdir(options.artifactDirectory, { recursive: true });
const plainDirectory = join(options.artifactDirectory, "hls");
const encryptedDirectory = join(options.artifactDirectory, "hls-aes");
await mkdir(plainDirectory, { recursive: true });
await mkdir(encryptedDirectory, { recursive: true });

const logger = new BoundedJsonl(
  join(options.artifactDirectory, "harness-events.jsonl"),
);
const keyId = randomBytes(16).toString("hex");
const keyPath = join(options.artifactDirectory, "hls-aes.key");
const keyInfoPath = join(options.artifactDirectory, "hls-aes-key-info.txt");
await writeFile(keyPath, randomBytes(16), { mode: 0o600 });
await writeFile(keyInfoPath, `/v1/key/${keyId}\n${keyPath}\n`, {
  encoding: "utf8",
  mode: 0o600,
});

const generators = [
  startHlsGenerator(plainDirectory, null),
  startHlsGenerator(encryptedDirectory, keyInfoPath),
];
await Promise.all([
  waitForPlaylist(join(plainDirectory, "index.m3u8"), generators[0]),
  waitForPlaylist(join(encryptedDirectory, "index.m3u8"), generators[1]),
]);

const server = createServer(async (request, response) => {
  const requestUrl = new URL(request.url ?? "/", "http://harness.invalid");
  const pathname = requestUrl.pathname;
  try {
    if (request.method !== "GET" || requestUrl.search !== "") {
      response.writeHead(400).end();
      return;
    }
    if (pathname === "/v1/health") {
      logger.write("request", { fixtureId: "health", resource: "control" });
      response.writeHead(200, {
        "Cache-Control": "no-store",
        "Content-Type": "application/json",
      });
      response.end(
        JSON.stringify({
          schemaVersion: 1,
          contractVersion: CONTRACT_VERSION,
          faultSchedule: null,
          aes128Supported: true,
        }),
      );
      return;
    }
    if (pathname === "/v1/stream/ts") {
      logger.write("request", { fixtureId: "clean-ts", resource: "stream" });
      response.writeHead(200, {
        "Cache-Control": "no-store",
        "Content-Type": "video/mp2t",
      });
      const child = spawn(
        "ffmpeg",
        [...ffmpegInputs(), "-f", "mpegts", "pipe:1"],
        { stdio: ["ignore", "pipe", "ignore"] },
      );
      child.stdout.pipe(response);
      response.once("close", () => child.kill("SIGTERM"));
      child.once("exit", () => {
        if (!response.writableEnded) response.end();
      });
      return;
    }
    if (pathname === `/v1/key/${keyId}`) {
      logger.write("request", {
        fixtureId: "clean-aes128-hls",
        resource: "key",
      });
      await serveFile(response, keyPath);
      return;
    }
    const match = pathname.match(
      /^\/v1\/stream\/(hls|hls-aes)\/(index\.m3u8|segment-\d{8}\.ts)$/,
    );
    if (match) {
      const encrypted = match[1] === "hls-aes";
      logger.write("request", {
        fixtureId: encrypted ? "clean-aes128-hls" : "clean-hls",
        resource: match[2] === "index.m3u8" ? "playlist" : "segment",
      });
      await serveFile(
        response,
        join(encrypted ? encryptedDirectory : plainDirectory, match[2]),
      );
      return;
    }
    response.writeHead(404).end();
  } catch {
    logger.write("request-failed", { reason: "fixture-resource-unavailable" });
    if (!response.headersSent) response.writeHead(404);
    response.end();
  }
});

await new Promise((resolvePromise, rejectPromise) => {
  server.once("error", rejectPromise);
  server.listen(options.port, options.bind, resolvePromise);
});

const ready = {
  schemaVersion: 1,
  contractVersion: CONTRACT_VERSION,
  faultSchedule: null,
  startedAt: new Date().toISOString(),
  bind: options.bind,
  port: options.port,
  playerPaths: {
    cleanTs: "/v1/stream/ts",
    cleanHls: "/v1/stream/hls/index.m3u8",
    cleanAes128Hls: "/v1/stream/hls-aes/index.m3u8",
  },
};
await writeFile(
  join(options.artifactDirectory, "harness-ready.json"),
  `${JSON.stringify(ready, null, 2)}\n`,
  "utf8",
);
logger.write("harness-started", {
  contractVersion: CONTRACT_VERSION,
  faultSchedule: "none",
});
console.log(JSON.stringify({ event: "slice8-harness-ready", ...ready }));

async function shutdown() {
  server.close();
  for (const generator of generators) generator.kill("SIGTERM");
  logger.write("harness-stopped");
  await logger.close();
  process.exit(0);
}

process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());
