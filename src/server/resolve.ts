import { promises as fs } from "node:fs";
import path from "node:path";

export interface ResolvedBinary {
  path: string;
  source: "setting" | "path" | "desktop";
}

export interface ResolveLogger {
  (line: string): void;
}

const WINDOWS_EXECUTABLES = ["opencode.exe", "opencode.cmd", "opencode"];
const UNIX_EXECUTABLES = ["opencode"];
/** Bounded scan: a PATH with dead network entries must not stall startup. */
const RESOLVE_TIMEOUT_MS = 8_000;

function pathCandidates(): string[] {
  const pathEnv = process.env.PATH ?? "";
  const names = process.platform === "win32" ? WINDOWS_EXECUTABLES : UNIX_EXECUTABLES;
  const result: string[] = [];
  for (const dir of pathEnv.split(path.delimiter)) {
    if (!dir) {
      continue;
    }
    for (const name of names) {
      result.push(path.join(dir, name));
    }
  }
  return result;
}

/** Bundled CLI from the OpenCode desktop app, per platform. */
export function desktopCandidates(): string[] {
  const result: string[] = [];
  if (process.platform === "win32") {
    const localAppData = process.env.LOCALAPPDATA;
    if (localAppData) {
      result.push(
        path.join(localAppData, "Programs", "ai.opencode.desktop", "resources", "opencode-cli.exe"),
      );
    }
    // Versioned CLIs the desktop app manages (e.g. %APPDATA%\ai.opencode.desktop\cli\2.3.0-x64\).
    const appData = process.env.APPDATA;
    if (appData) {
      result.push(
        path.join(appData, "ai.opencode.desktop", "cli", "*", "opencode-cli.exe"),
      );
    }
  } else if (process.platform === "darwin") {
    for (const apps of [process.env.HOME + "/Applications", "/Applications"]) {
      if (apps) {
        result.push(path.join(apps, "OpenCode.app", "Contents", "Resources", "opencode-cli"));
      }
    }
  } else {
    const home = process.env.HOME;
    if (home) {
      result.push(path.join(home, ".opencode", "bin", "opencode"));
    }
    result.push("/usr/local/bin/opencode", "/usr/bin/opencode");
  }
  return result;
}

async function executableExists(candidate: string): Promise<boolean> {
  try {
    await fs.access(candidate, fs.constants.X_OK);
    return (await fs.stat(candidate)).isFile();
  } catch {
    return false;
  }
}

/** Expand glob-style `*` segments (used for versioned desktop CLI dirs). */
async function expandGlobCandidates(candidates: string[]): Promise<string[]> {
  const expanded: string[] = [];
  for (const candidate of candidates) {
    if (!candidate.includes("*")) {
      expanded.push(candidate);
      continue;
    }
    const starIndex = candidate.indexOf("*");
    const parent = candidate.slice(0, candidate.lastIndexOf(path.sep, starIndex));
    try {
      for (const entry of await fs.readdir(parent)) {
        expanded.push(candidate.replace("*", entry));
      }
    } catch {
      // parent missing — skip
    }
  }
  // Highest version last so later candidates win ties in practice.
  return expanded.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

/**
 * Resolve the opencode CLI binary: explicit setting first, then PATH
 * lookup, then the CLI bundled inside the OpenCode desktop app.
 * Overall bounded so dead PATH entries cannot stall startup indefinitely;
 * on timeout we fall straight back to the desktop-bundled binary.
 */
export async function resolveBinary(settingPath: string, log?: ResolveLogger): Promise<ResolvedBinary | null> {
  const say = log ?? (() => {});

  if (settingPath.trim()) {
    if (await executableExists(settingPath.trim())) {
      return { path: settingPath.trim(), source: "setting" };
    }
    say(`configured opencode.path does not exist: ${settingPath}`);
  }

  const race = (work: Promise<ResolvedBinary | null>, fallback: Promise<ResolvedBinary | null>) =>
    Promise.race([
      work.catch(() => null),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), RESOLVE_TIMEOUT_MS)),
    ]).then((result) => result ?? fallback);

  const desktopSearch = async (): Promise<ResolvedBinary | null> => {
    const candidates = await expandGlobCandidates(desktopCandidates());
    for (const candidate of candidates) {
      if (await executableExists(candidate)) {
        return { path: candidate, source: "desktop" };
      }
    }
    return null;
  };

  const pathSearch = async (): Promise<ResolvedBinary | null> => {
    const candidates = pathCandidates();
    say(`scanning ${candidates.length} PATH candidates for opencode binary`);
    for (const candidate of candidates) {
      if (await executableExists(candidate)) {
        return { path: candidate, source: "path" };
      }
    }
    return null;
  };

  // PATH scan is raced against the timeout; if it stalls we go desktop-first.
  const viaPath = await race(pathSearch(), desktopSearch());
  if (viaPath) {
    return viaPath;
  }
  return desktopSearch();
}
