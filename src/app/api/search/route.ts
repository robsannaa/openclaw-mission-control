import { NextRequest, NextResponse } from "next/server";
import { execFile } from "child_process";
import { promisify } from "util";
import { getOpenClawBin } from "@/lib/paths";

const exec = promisify(execFile);

export const dynamic = "force-dynamic";

type SearchResult = {
  path: string;
  startLine: number;
  endLine: number;
  score: number;
  snippet: string;
  source: string;
};

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const query = searchParams.get("q");

  if (!query || query.trim().length < 2) {
    return NextResponse.json({ results: [], query: query || "" });
  }

  try {
    // Find the openclaw binary (auto-discovered)
    const bin = await getOpenClawBin();

    const { stdout } = await exec(bin, ["memory", "search", query.trim(), "--json"], {
      timeout: 10000,
      env: {
        ...process.env,
        NO_COLOR: "1",
      },
    });

    const parsed = JSON.parse(stdout) as { results: SearchResult[] };

    // Sanitize: strip any passwords or sensitive data from snippets
    const results = (parsed.results || []).map((r) => ({
      path: r.path,
      startLine: r.startLine,
      endLine: r.endLine,
      score: r.score,
      snippet: sanitizeSnippet(r.snippet),
      source: r.source,
    }));

    return NextResponse.json({ results, query });
  } catch (err) {
    console.error("Search API error:", err);
    return NextResponse.json({ results: [], query, error: "Search failed" });
  }
}

/** Strip potential sensitive data from snippets */
function sanitizeSnippet(text: string): string {
  // Redact anything that looks like a password or API key
  return text
    .replace(/password:\s*\S+/gi, "password: [REDACTED]")
    .replace(/api[_-]?key:\s*\S+/gi, "api_key: [REDACTED]")
    .replace(/token:\s*[A-Za-z0-9_\-]{20,}/g, "token: [REDACTED]");
}
