import { promises as fs } from "node:fs";
import path from "node:path";

export interface ResolvedBinary {
  path: string;
  source: "setting" | "path" | "desktop";
}

const WINDOWS_EXECUTABLES = ["opencode.exe", "opencode.cmd", "opencode"];
const UNIX_EXECUTABLES = ["opencode"];

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
function desktopCandidates(): string[] {
  const result: string[] = [];
  if (process.platform === "win32") {
    const localAppData = process.env.LOCALAPPDATA;
    if (localAppData) {
      result.push(
        path.join(localAppData, "Programs", "ai.opencode.desktop", "resources", "opencode-cli.exe"),
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

/**
 * Resolve the opencode CLI binary: explicit setting first, then PATH
 * lookup, then the CLI bundled inside the OpenCode desktop app.
 */
export async function resolveBinary(settingPath: string): Promise<ResolvedBinary | null> {
  const tried: string[] = [];
  if (settingPath.trim()) {
    if (await executableExists(settingPath.trim())) {
      return { path: settingPath.trim(), source: "setting" };
    }
    tried.push(`setting: ${settingPath}`);
  }
  for (const candidate of pathCandidates()) {
    if (await executableExists(candidate)) {
      return { path: candidate, source: "path" };
    }
  }
  for (const candidate of desktopCandidates()) {
    if (await executableExists(candidate)) {
      return { path: candidate, source: "desktop" };
    }
    tried.push(candidate);
  }
  void tried;
  return null;
}
