import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const COMMIT_PATTERN = /^[a-f0-9]{40}$/;

export interface PinnedMpvManifest {
  schemaVersion: 1;
  status: "pinned";
  target: {
    platform: "win32";
    arch: "x64";
  };
  artifact: {
    url: string;
    fileName: string;
    sha256: string;
    sizeBytes: number;
    releaseUrl: string;
  };
  source: {
    upstreamInstallationUrl: string;
    buildProjectUrl: string;
    buildProjectCommit: string;
    buildProjectSourceUrl: string;
    workflowUrl: string;
    mpvRepositoryUrl: string;
    mpvCommit: string;
    mpvSourceUrl: string;
    ffmpegRepositoryUrl: string;
    ffmpegCommit: string;
    ffmpegSourceUrl: string;
    buildConfiguration: Record<string, unknown>;
  };
  selectedAt: string;
  notes: string;
}

interface RuntimeVerification {
  schemaVersion: 1;
  status: "verified";
  artifactSha256: string;
  manifestSha256: string;
  mpvExeSha256: string;
}

export interface VerifiedMpvRuntime {
  executablePath: string;
  manifest: PinnedMpvManifest;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringField(record: Record<string, unknown>, field: string): string {
  const value = record[field];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`invalid-manifest-${field}`);
  }
  return value;
}

function recordField(
  record: Record<string, unknown>,
  field: string,
): Record<string, unknown> {
  const value = record[field];
  if (!isRecord(value)) throw new Error(`invalid-manifest-${field}`);
  return value;
}

function stringArrayField(
  record: Record<string, unknown>,
  field: string,
): readonly string[] {
  const value = record[field];
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    !value.every((item) => typeof item === "string" && item.length > 0)
  ) {
    throw new Error(`invalid-manifest-${field}`);
  }
  return value;
}

function parseHttpsUrl(value: string, field: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`invalid-manifest-${field}`);
  }
  if (url.protocol !== "https:") throw new Error(`invalid-manifest-${field}`);
  return value;
}

export function parsePinnedMpvManifest(json: string): PinnedMpvManifest {
  const value: unknown = JSON.parse(json.replace(/^\uFEFF/, ""));
  if (!isRecord(value)) throw new Error("invalid-manifest-root");
  if (value.schemaVersion !== 1 || value.status !== "pinned") {
    throw new Error("runtime-not-pinned");
  }

  const target = recordField(value, "target");
  if (target.platform !== "win32" || target.arch !== "x64") {
    throw new Error("invalid-manifest-target");
  }

  const artifact = recordField(value, "artifact");
  const artifactUrl = parseHttpsUrl(
    stringField(artifact, "url"),
    "artifact-url",
  );
  if (/(^|[/_-])latest([/_-]|$)/i.test(new URL(artifactUrl).pathname)) {
    throw new Error("mutable-artifact-url");
  }
  const fileName = stringField(artifact, "fileName");
  const sha256 = stringField(artifact, "sha256");
  if (!/^[^/\\]+\.7z$/.test(fileName) || !SHA256_PATTERN.test(sha256)) {
    throw new Error("invalid-manifest-artifact");
  }
  if (!artifactUrl.endsWith(`/${fileName}`)) {
    throw new Error("artifact-filename-mismatch");
  }
  if (
    typeof artifact.sizeBytes !== "number" ||
    !Number.isSafeInteger(artifact.sizeBytes) ||
    artifact.sizeBytes <= 0
  ) {
    throw new Error("invalid-manifest-artifact-size");
  }

  const source = recordField(value, "source");
  const buildProjectCommit = stringField(source, "buildProjectCommit");
  const mpvCommit = stringField(source, "mpvCommit");
  const ffmpegCommit = stringField(source, "ffmpegCommit");
  if (
    !COMMIT_PATTERN.test(buildProjectCommit) ||
    !COMMIT_PATTERN.test(mpvCommit) ||
    !COMMIT_PATTERN.test(ffmpegCommit)
  ) {
    throw new Error("invalid-manifest-source-commit");
  }
  const buildConfiguration = recordField(source, "buildConfiguration");
  if (
    buildConfiguration.targetTriplet !== "x86_64-w64-mingw32" ||
    buildConfiguration.cpuBaseline !== "x86-64"
  ) {
    throw new Error("invalid-manifest-build-configuration");
  }
  stringField(buildConfiguration, "workflow");
  stringField(buildConfiguration, "compiler");
  stringField(buildConfiguration, "artifactFlavor");
  stringArrayField(buildConfiguration, "cmakeOptions");
  stringArrayField(buildConfiguration, "mpvOptions");
  stringArrayField(buildConfiguration, "ffmpegLicenseOptions");

  const selectedAt = stringField(value, "selectedAt");
  if (Number.isNaN(Date.parse(selectedAt))) {
    throw new Error("invalid-manifest-selected-at");
  }

  return {
    schemaVersion: 1,
    status: "pinned",
    target: { platform: "win32", arch: "x64" },
    artifact: {
      url: artifactUrl,
      fileName,
      sha256,
      sizeBytes: artifact.sizeBytes,
      releaseUrl: parseHttpsUrl(
        stringField(artifact, "releaseUrl"),
        "release-url",
      ),
    },
    source: {
      upstreamInstallationUrl: parseHttpsUrl(
        stringField(source, "upstreamInstallationUrl"),
        "upstream-installation-url",
      ),
      buildProjectUrl: parseHttpsUrl(
        stringField(source, "buildProjectUrl"),
        "build-project-url",
      ),
      buildProjectCommit,
      buildProjectSourceUrl: parseHttpsUrl(
        stringField(source, "buildProjectSourceUrl"),
        "build-project-source-url",
      ),
      workflowUrl: parseHttpsUrl(
        stringField(source, "workflowUrl"),
        "workflow-url",
      ),
      mpvRepositoryUrl: parseHttpsUrl(
        stringField(source, "mpvRepositoryUrl"),
        "mpv-repository-url",
      ),
      mpvCommit,
      mpvSourceUrl: parseHttpsUrl(
        stringField(source, "mpvSourceUrl"),
        "mpv-source-url",
      ),
      ffmpegRepositoryUrl: parseHttpsUrl(
        stringField(source, "ffmpegRepositoryUrl"),
        "ffmpeg-repository-url",
      ),
      ffmpegCommit,
      ffmpegSourceUrl: parseHttpsUrl(
        stringField(source, "ffmpegSourceUrl"),
        "ffmpeg-source-url",
      ),
      buildConfiguration,
    },
    selectedAt,
    notes: stringField(value, "notes"),
  };
}

function parseRuntimeVerification(json: string): RuntimeVerification {
  const value: unknown = JSON.parse(json.replace(/^\uFEFF/, ""));
  if (!isRecord(value)) throw new Error("invalid-runtime-verification");
  if (value.schemaVersion !== 1 || value.status !== "verified") {
    throw new Error("runtime-not-verified");
  }

  const artifactSha256 = stringField(value, "artifactSha256");
  const manifestSha256 = stringField(value, "manifestSha256");
  const mpvExeSha256 = stringField(value, "mpvExeSha256");
  if (
    !SHA256_PATTERN.test(artifactSha256) ||
    !SHA256_PATTERN.test(manifestSha256) ||
    !SHA256_PATTERN.test(mpvExeSha256)
  ) {
    throw new Error("invalid-runtime-verification-hash");
  }

  return {
    schemaVersion: 1,
    status: "verified",
    artifactSha256,
    manifestSha256,
    mpvExeSha256,
  };
}

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export async function loadVerifiedMpvRuntime(
  applicationRoot: string,
): Promise<VerifiedMpvRuntime> {
  const manifestPath = join(
    applicationRoot,
    "runtime",
    "mpv",
    "windows-x64.json",
  );
  const runtimeRoot = join(
    applicationRoot,
    "runtime",
    "mpv",
    "bin",
    "windows-x64",
  );
  const executablePath = join(runtimeRoot, "mpv.exe");
  const verificationPath = join(runtimeRoot, "verification.json");

  const [manifestBytes, verificationJson, executableBytes] = await Promise.all([
    readFile(manifestPath),
    readFile(verificationPath, "utf8"),
    readFile(executablePath),
  ]);
  const manifest = parsePinnedMpvManifest(manifestBytes.toString("utf8"));
  const verification = parseRuntimeVerification(verificationJson);

  if (
    verification.artifactSha256 !== manifest.artifact.sha256 ||
    verification.manifestSha256 !== sha256(manifestBytes) ||
    verification.mpvExeSha256 !== sha256(executableBytes)
  ) {
    throw new Error("runtime-verification-mismatch");
  }

  return { executablePath, manifest };
}
