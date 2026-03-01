import { NextRequest, NextResponse } from "next/server";
import { access, readFile } from "fs/promises";
import { constants as fsConstants } from "fs";
import { homedir } from "os";
import { join } from "path";
import { runCli, runCliJson } from "@/lib/openclaw";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type BrowserStatus = {
  enabled?: boolean;
  profile?: string;
  running?: boolean;
  cdpReady?: boolean;
  cdpHttp?: boolean;
  pid?: number | null;
  cdpPort?: number;
  cdpUrl?: string;
  chosenBrowser?: string | null;
  detectedBrowser?: string | null;
  detectedExecutablePath?: string | null;
  detectError?: string | null;
  userDataDir?: string | null;
  color?: string;
  headless?: boolean;
  noSandbox?: boolean;
  executablePath?: string | null;
  attachOnly?: boolean;
};

type BrowserProfiles = {
  profiles?: Array<{
    name: string;
    cdpPort?: number;
    cdpUrl?: string;
    color?: string;
    running?: boolean;
    tabCount?: number;
    isDefault?: boolean;
    isRemote?: boolean;
  }>;
};

type BrowserTabs = {
  tabs?: Array<Record<string, unknown>>;
};

type RelaySnapshot = {
  status: BrowserStatus | null;
  profiles: BrowserProfiles["profiles"];
  tabs: BrowserTabs["tabs"];
  extension: {
    path: string | null;
    resolvedPath: string | null;
    manifestPath: string | null;
    installed: boolean;
    manifestName: string | null;
    manifestVersion: string | null;
    error: string | null;
  };
  health: {
    installed: boolean;
    running: boolean;
    cdpReady: boolean;
    tabConnected: boolean;
    relayReady: boolean;
  };
  errors: {
    status: string | null;
    profiles: string | null;
    tabs: string | null;
  };
};

function parseError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function parseExtensionPath(stdout: string): string | null {
  const lines = stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  for (const line of lines) {
    if (line.startsWith("~") || line.startsWith("/") || /^[A-Za-z]:\\/.test(line)) {
      return line;
    }
  }
  return lines[0] || null;
}

function expandHome(pathValue: string | null): string | null {
  if (!pathValue) return null;
  if (pathValue === "~") return homedir();
  if (pathValue.startsWith("~/")) return join(homedir(), pathValue.slice(2));
  return pathValue;
}

async function pathExists(pathValue: string): Promise<boolean> {
  try {
    await access(pathValue, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function runBrowserJson<T>(
  command: string[],
  profile: string | null,
  timeout = 15000
): Promise<T> {
  const args = ["browser"];
  if (profile) args.push("--browser-profile", profile);
  args.push(...command);
  return runCliJson<T>(args, timeout);
}

async function runBrowserText(
  command: string[],
  profile: string | null,
  timeout = 15000
): Promise<string> {
  const args = ["browser"];
  if (profile) args.push("--browser-profile", profile);
  args.push(...command);
  return runCli(args, timeout);
}

function sanitizeProfile(value: string | null): string | null {
  const v = (value || "").trim();
  if (!v) return null;
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(v)) return null;
  return v;
}

async function buildSnapshot(profile: string | null): Promise<RelaySnapshot> {
  const statusP = runBrowserJson<BrowserStatus>(["status"], profile, 12000)
    .then((value) => ({ value, error: null as string | null }))
    .catch((err) => ({ value: null, error: parseError(err) }));
  const profilesP = runCliJson<BrowserProfiles>(["browser", "profiles"], 12000)
    .then((value) => ({ value, error: null as string | null }))
    .catch((err) => ({ value: null, error: parseError(err) }));
  const tabsP = runBrowserJson<BrowserTabs>(["tabs"], profile, 12000)
    .then((value) => ({ value, error: null as string | null }))
    .catch((err) => ({ value: null, error: parseError(err) }));
  const extensionPathP = runCli(["browser", "extension", "path"], 12000)
    .then((value) => ({ value, error: null as string | null }))
    .catch((err) => ({ value: "", error: parseError(err) }));

  const [statusR, profilesR, tabsR, extensionPathR] = await Promise.all([
    statusP,
    profilesP,
    tabsP,
    extensionPathP,
  ]);

  const extensionPath = parseExtensionPath(extensionPathR.value || "");
  const resolvedPath = expandHome(extensionPath);
  const manifestPath = resolvedPath ? join(resolvedPath, "manifest.json") : null;
  let installed = false;
  let manifestName: string | null = null;
  let manifestVersion: string | null = null;
  let extensionError: string | null = extensionPathR.error;

  if (resolvedPath) {
    installed = await pathExists(resolvedPath);
  }

  if (installed && manifestPath) {
    try {
      const raw = await readFile(manifestPath, "utf-8");
      const manifest = JSON.parse(raw) as { name?: string; version?: string };
      manifestName = manifest.name || null;
      manifestVersion = manifest.version || null;
    } catch (err) {
      extensionError = extensionError || parseError(err);
    }
  }

  const status = statusR.value;
  const tabs = tabsR.value?.tabs || [];
  const running = Boolean(status?.running);
  const cdpReady = Boolean(status?.cdpReady && status?.cdpHttp);
  const tabConnected = tabs.length > 0;

  return {
    status,
    profiles: profilesR.value?.profiles || [],
    tabs,
    extension: {
      path: extensionPath,
      resolvedPath,
      manifestPath,
      installed,
      manifestName,
      manifestVersion,
      error: extensionError,
    },
    health: {
      installed,
      running,
      cdpReady,
      tabConnected,
      relayReady: installed && running && cdpReady && tabConnected,
    },
    errors: {
      status: statusR.error,
      profiles: profilesR.error,
      tabs: tabsR.error,
    },
  };
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const profile = sanitizeProfile(searchParams.get("profile"));
    const snapshot = await buildSnapshot(profile);
    return NextResponse.json({
      ok: true,
      profile,
      snapshot,
      docsUrl: "https://docs.openclaw.ai/tools/browser#chrome-extension-relay-use-your-existing-chrome",
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: parseError(err) },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  let profile: string | null = null;
  try {
    const body = (await request.json().catch(() => ({}))) as {
      action?: string;
      profile?: string | null;
      url?: string;
    };
    const action = String(body.action || "").trim();
    profile = sanitizeProfile(body.profile || null);
    if (!action) {
      return NextResponse.json(
        { ok: false, error: "Action is required" },
        { status: 400 }
      );
    }

    let result: Record<string, unknown> = {};
    switch (action) {
      case "start": {
        result = await runBrowserJson<Record<string, unknown>>(["start"], profile, 15000);
        break;
      }
      case "stop": {
        result = await runBrowserJson<Record<string, unknown>>(["stop"], profile, 15000);
        break;
      }
      case "restart": {
        await runBrowserText(["stop"], profile, 15000).catch(() => "");
        result = await runBrowserJson<Record<string, unknown>>(["start"], profile, 20000);
        break;
      }
      case "install-extension": {
        const output = await runCli(["browser", "extension", "install"], 20000);
        result = { output };
        break;
      }
      case "open-test-tab": {
        const targetUrl = (body.url || "").trim() || "https://docs.openclaw.ai/tools/browser";
        result = await runBrowserJson<Record<string, unknown>>(
          ["open", targetUrl],
          profile,
          20000
        );
        break;
      }
      case "snapshot-test": {
        result = await runBrowserJson<Record<string, unknown>>(
          ["snapshot", "--efficient", "--limit", "60"],
          profile,
          25000
        );
        break;
      }
      default:
        return NextResponse.json(
          { ok: false, error: `Unknown action: ${action}` },
          { status: 400 }
        );
    }

    const snapshot = await buildSnapshot(profile);
    return NextResponse.json({ ok: true, action, result, snapshot });
  } catch (err) {
    const snapshot = await buildSnapshot(profile).catch(() => null);
    return NextResponse.json(
      { ok: false, error: parseError(err), snapshot },
      { status: 500 }
    );
  }
}

