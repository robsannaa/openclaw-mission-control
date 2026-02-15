import { NextRequest, NextResponse } from "next/server";
import { runCliJson, runCli, gatewayCall } from "@/lib/openclaw-cli";
import { getOpenClawHome } from "@/lib/paths";
import { stat } from "fs/promises";
import { join } from "path";

export const dynamic = "force-dynamic";

/* ── Types ────────────────────────────────────────── */

type MemoryStatus = {
  agentId: string;
  status: {
    backend: string;
    files: number;
    chunks: number;
    dirty: boolean;
    workspaceDir: string;
    dbPath: string;
    provider: string;
    model: string;
    requestedProvider: string;
    sources: string[];
    extraPaths: string[];
    sourceCounts: { source: string; files: number; chunks: number }[];
    cache: { enabled: boolean; entries: number };
    fts: { enabled: boolean; available: boolean };
    vector: {
      enabled: boolean;
      available: boolean;
      extensionPath?: string;
      dims?: number;
    };
    batch: {
      enabled: boolean;
      failures: number;
      limit: number;
      wait: boolean;
      concurrency: number;
      pollIntervalMs: number;
      timeoutMs: number;
    };
  };
  scan: {
    sources: { source: string; totalFiles: number; issues: string[] }[];
    totalFiles: number;
    issues: string[];
  };
};

type SearchResult = {
  path: string;
  startLine: number;
  endLine: number;
  score: number;
  snippet: string;
  source: string;
};

/* ── Helpers ──────────────────────────────────────── */

function sanitizeSnippet(text: string): string {
  return text
    .replace(/password:\s*\S+/gi, "password: [REDACTED]")
    .replace(/api[_-]?key:\s*\S+/gi, "api_key: [REDACTED]")
    .replace(/token:\s*[A-Za-z0-9_\-]{20,}/g, "token: [REDACTED]")
    .replace(/shpat_[A-Za-z0-9]+/g, "[REDACTED]");
}

async function getDbFileSize(dbPath: string): Promise<number> {
  try {
    const s = await stat(dbPath);
    return s.size;
  } catch {
    return 0;
  }
}

/* ── GET: status + search ─────────────────────────── */

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const scope = searchParams.get("scope") || "status";

  try {
    if (scope === "status") {
      // Get memory status for all agents
      const agents = await runCliJson<MemoryStatus[]>(
        ["memory", "status"],
        15000
      );

      // Enrich with DB file sizes
      const enriched = await Promise.all(
        agents.map(async (a) => ({
          ...a,
          dbSizeBytes: await getDbFileSize(a.status.dbPath),
        }))
      );

      // Get embedding config from config.get
      let embeddingConfig: Record<string, unknown> | null = null;
      try {
        const configData = await gatewayCall<Record<string, unknown>>(
          "config.get",
          undefined,
          10000
        );
        const resolved = (configData.resolved || {}) as Record<string, unknown>;
        const agents_config = (resolved.agents || {}) as Record<string, unknown>;
        const defaults = (agents_config.defaults || {}) as Record<string, unknown>;
        embeddingConfig = {
          model: defaults.model || null,
          contextTokens: defaults.contextTokens || null,
        };
      } catch {
        // config not available
      }

      return NextResponse.json({
        agents: enriched,
        embeddingConfig,
        home: getOpenClawHome(),
      });
    }

    if (scope === "search") {
      const query = searchParams.get("q") || "";
      const agent = searchParams.get("agent") || "";
      const maxResults = searchParams.get("max") || "10";
      const minScore = searchParams.get("minScore") || "";

      if (!query || query.trim().length < 2) {
        return NextResponse.json({ results: [], query });
      }

      const args = ["memory", "search", query.trim()];
      if (agent) args.push("--agent", agent);
      args.push("--max-results", maxResults);
      if (minScore) args.push("--min-score", minScore);

      const data = await runCliJson<{ results: SearchResult[] }>(
        args,
        15000
      );

      const results = (data.results || []).map((r) => ({
        ...r,
        snippet: sanitizeSnippet(r.snippet),
      }));

      return NextResponse.json({ results, query });
    }

    return NextResponse.json({ error: "Unknown scope" }, { status: 400 });
  } catch (err) {
    console.error("Vector API GET error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

/* ── POST: reindex + config updates ──────────────── */

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const action = body.action as string;

    switch (action) {
      case "reindex": {
        const agent = body.agent as string | undefined;
        const force = body.force as boolean | undefined;
        const args = ["memory", "index"];
        if (agent) args.push("--agent", agent);
        if (force) args.push("--force");
        args.push("--verbose");

        const output = await runCli(args, 60000);
        return NextResponse.json({ ok: true, action, output });
      }

      case "update-embedding-model": {
        // Update embedding provider/model via config.patch
        const provider = body.provider as string;
        const model = body.model as string;

        if (!provider || !model) {
          return NextResponse.json(
            { error: "provider and model required" },
            { status: 400 }
          );
        }

        const configData = await gatewayCall<Record<string, unknown>>(
          "config.get",
          undefined,
          10000
        );
        const hash = configData.hash as string;

        // The memory embedding config is at agents.defaults level
        // Patch the memory search config
        const patchRaw = JSON.stringify({
          memory: {
            provider,
            model,
          },
        });

        await gatewayCall(
          "config.patch",
          { raw: patchRaw, baseHash: hash },
          15000
        );

        return NextResponse.json({ ok: true, action, provider, model });
      }

      default:
        return NextResponse.json(
          { error: `Unknown action: ${action}` },
          { status: 400 }
        );
    }
  } catch (err) {
    console.error("Vector API POST error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
