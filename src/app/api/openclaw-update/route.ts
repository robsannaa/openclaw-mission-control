import { NextResponse } from "next/server";
import { runCli } from "@/lib/openclaw-cli";

const GITHUB_RELEASES_URL =
  "https://api.github.com/repos/openclaw/openclaw/releases/latest";

/** Normalize version string for comparison (e.g. "v2026.2.19" or "2026.2.19" -> "2026.2.19"). */
function normalizeVersion(v: string): string {
  return String(v || "").replace(/^v/i, "").trim();
}

/**
 * Compare two calendar-style versions (e.g. 2026.2.19).
 * Returns: 1 if a > b, -1 if a < b, 0 if equal.
 */
function compareVersions(a: string, b: string): number {
  const pa = normalizeVersion(a).split(".").map(Number);
  const pb = normalizeVersion(b).split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = pa[i] ?? 0;
    const nb = pb[i] ?? 0;
    if (na > nb) return 1;
    if (na < nb) return -1;
  }
  return 0;
}

export const dynamic = "force-dynamic";

/**
 * GET /api/openclaw-update
 * Returns current OpenClaw version, latest release from GitHub, and whether an update is available.
 * Optionally includes changelog (release body) for the latest release.
 */
export async function GET() {
  try {
    let currentVersion = "";
    try {
      const out = await runCli(["--version"], 5000);
      currentVersion = (out || "").trim().replace(/^openclaw\s+/i, "").trim();
    } catch {
      // Fallback: might be in config; leave currentVersion empty and we'll still show latest
    }

    const res = await fetch(GITHUB_RELEASES_URL, {
      next: { revalidate: 3600 },
      headers: { Accept: "application/vnd.github+json" },
    });
    if (!res.ok) {
      return NextResponse.json({
        currentVersion: currentVersion || null,
        latestVersion: null,
        updateAvailable: false,
        error: "Could not fetch latest release",
      });
    }

    const release = (await res.json()) as {
      tag_name?: string;
      name?: string;
      body?: string | null;
      html_url?: string;
    };
    const latestVersion = normalizeVersion(release.tag_name || release.name || "");
    const updateAvailable =
      !!currentVersion &&
      !!latestVersion &&
      compareVersions(latestVersion, currentVersion) > 0;

    return NextResponse.json({
      currentVersion: currentVersion || null,
      latestVersion: latestVersion || null,
      updateAvailable,
      changelog: release.body?.trim() || null,
      releaseUrl: release.html_url || `https://github.com/openclaw/openclaw/releases/tag/${release.tag_name || "latest"}`,
    });
  } catch (err) {
    console.error("OpenClaw update check error:", err);
    return NextResponse.json({
      currentVersion: null,
      latestVersion: null,
      updateAvailable: false,
      error: String(err),
    });
  }
}
