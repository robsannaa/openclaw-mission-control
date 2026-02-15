import { NextRequest, NextResponse } from "next/server";
import { runCliJson, runCli, gatewayCall } from "@/lib/openclaw-cli";
import { getOpenClawHome } from "@/lib/paths";
import { stat } from "fs/promises";

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

      // Get embedding config + memorySearch from config.get
      let embeddingConfig: Record<string, unknown> | null = null;
      let memorySearch: Record<string, unknown> | null = null;
      let configHash: string | null = null;
      try {
        const configData = await gatewayCall<Record<string, unknown>>(
          "config.get",
          undefined,
          10000
        );
        configHash = (configData.hash as string) || null;
        const resolved = (configData.resolved || {}) as Record<string, unknown>;
        const agents_config = (resolved.agents || {}) as Record<string, unknown>;
        const defaults = (agents_config.defaults || {}) as Record<string, unknown>;
        embeddingConfig = {
          model: defaults.model || null,
          contextTokens: defaults.contextTokens || null,
        };
        memorySearch = (defaults.memorySearch || null) as Record<string, unknown> | null;
      } catch {
        // config not available
      }

      // Get authenticated embedding providers
      let authProviders: string[] = [];
      try {
        const modelsRes = await runCliJson<Record<string, unknown>>(["models", "status"], 10000);
        const auth = ((modelsRes as Record<string, unknown>).auth || {}) as Record<string, unknown>;
        const providersList = (auth.providers || []) as Array<Record<string, unknown>>;
        authProviders = providersList
          .filter((p) => p.effective)
          .map((p) => String(p.provider));
      } catch {
        // fallback: try to detect from env keys
        if (process.env.OPENAI_API_KEY) authProviders.push("openai");
        if (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY) authProviders.push("google");
      }

      return NextResponse.json({
        agents: enriched,
        embeddingConfig,
        memorySearch,
        configHash,
        authProviders,
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

      case "setup-memory": {
        // One-click setup: enable memorySearch with given provider/model
        const setupProvider = body.provider as string;
        const setupModel = body.model as string;

        if (!setupProvider || !setupModel) {
          return NextResponse.json(
            { error: "provider and model required" },
            { status: 400 }
          );
        }

        const setupConfig = await gatewayCall<Record<string, unknown>>(
          "config.get",
          undefined,
          10000
        );
        const setupHash = setupConfig.hash as string;

        const setupPatch = JSON.stringify({
          agents: {
            defaults: {
              memorySearch: {
                enabled: true,
                provider: setupProvider,
                model: setupModel,
                sources: ["memory"],
              },
            },
          },
        });

        await gatewayCall(
          "config.patch",
          { raw: setupPatch, baseHash: setupHash, restartDelayMs: 2000 },
          15000
        );

        // Trigger initial index
        try {
          await runCli(["memory", "index"], 30000);
        } catch {
          // indexing can fail if no memory files yet, that's fine
        }

        return NextResponse.json({ ok: true, action, provider: setupProvider, model: setupModel });
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
