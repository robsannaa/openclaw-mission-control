import { NextRequest, NextResponse } from "next/server";
import { readdir, stat, unlink } from "fs/promises";
import { dirname, resolve } from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import { runCliJson, gatewayCall } from "@/lib/openclaw";
import { getOpenClawHome, getDefaultWorkspace, getOpenClawBin } from "@/lib/paths";
import { buildModelsSummary } from "@/lib/models-summary";
import { gatewayMemorySearch, gatewayMemoryIndex } from "@/lib/gateway-tools";

const exec = promisify(execFile);

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

async function deleteIfExists(path: string): Promise<boolean> {
  try {
    await unlink(path);
    return true;
  } catch {
    return false;
  }
}

async function resolveNamespaceDbPath(agentId: string): Promise<string | null> {
  try {
    const rows = await runCliJson<MemoryStatus[]>(["memory", "status"], 15000);
    const match = Array.isArray(rows)
      ? rows.find((row) => String(row.agentId || "").trim() === agentId)
      : null;
    const dbPath = String(match?.status?.dbPath || "").trim();
    return dbPath || null;
  } catch {
    return null;
  }
}

/** Returns all root-level .md files in the workspace (excluding MEMORY.md) for memorySearch.extraPaths. */
async function getWorkspaceReferencePaths(): Promise<string[]> {
  try {
    const workspace = await getDefaultWorkspace();
    const entries = await readdir(workspace, { withFileTypes: true });
    return entries
      .filter((e) => e.isFile() && e.name.endsWith(".md") && e.name !== "MEMORY.md" && e.name !== "memory.md")
      .map((e) => e.name)
      .sort();
  } catch {
    return [];
  }
}

/* ── GET: status + search ─────────────────────────── */

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const scope = searchParams.get("scope") || "status";

  try {
    if (scope === "status") {
      // Get memory status for all agents (kept as CLI — detailed runtime data)
      let agents: MemoryStatus[] = [];
      let agentsWarning: string | null = null;
      try {
        agents = await runCliJson<MemoryStatus[]>(
          ["memory", "status"],
          15000
        );
      } catch (err) {
        agentsWarning = String(err);
      }

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

      // Get authenticated embedding providers without spawning the CLI.
      let authProviders: string[] = [];
      try {
        const modelsSummary = await buildModelsSummary();
        authProviders = (modelsSummary.status.auth?.providers || [])
          .filter((provider) => provider.effective)
          .map((provider) => String(provider.provider || "").trim())
          .filter(Boolean);
      } catch {
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
        warning: agentsWarning || undefined,
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

      // Try gateway tool first; fall back to CLI if the tool isn't registered
      let data: { results: SearchResult[] };
      try {
        data = await gatewayMemorySearch({
          query: query.trim(),
          agent: agent || undefined,
          maxResults: parseInt(maxResults, 10) || 10,
          minScore: minScore || undefined,
        });
      } catch (gwErr) {
        const is404 = gwErr instanceof Error && gwErr.message.includes("(404)");
        if (!is404) throw gwErr;

        const bin = await getOpenClawBin();
        const args = ["memory", "search", query.trim(), "--json", "--max-results", String(parseInt(maxResults, 10) || 10)];
        if (agent) args.push("--agent", agent);
        if (minScore) args.push("--min-score", minScore);
        const { stdout } = await exec(bin, args, {
          timeout: 30000,
          env: { ...process.env, NO_COLOR: "1" },
        });
        const parsed = JSON.parse(stdout || "{}") as { results?: SearchResult[] };
        data = { results: Array.isArray(parsed.results) ? parsed.results : [] };
      }

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

        // Try gateway tool first; fall back to CLI if the tool isn't registered
        // (memory_index is a CLI-only operation in most gateway versions — see #25).
        let output: string;
        try {
          output = await gatewayMemoryIndex({
            agent: agent || undefined,
            force: force || undefined,
          });
        } catch (gwErr) {
          const is404 = gwErr instanceof Error && gwErr.message.includes("(404)");
          if (!is404) throw gwErr;

          const bin = await getOpenClawBin();
          // `openclaw memory index` supports --agent and --verbose only (no --force).
          // For force-reindex, use `memory status --deep --index` which reindexes dirty stores.
          const args = force
            ? ["memory", "status", "--deep", "--index"]
            : ["memory", "index"];
          if (agent) args.push("--agent", agent);
          const { stdout } = await exec(bin, args, {
            timeout: 60000,
            env: { ...process.env, NO_COLOR: "1" },
          });
          output = stdout || "Reindex completed via CLI";
        }

        return NextResponse.json({ ok: true, action, output });
      }

      case "delete-namespace": {
        const agent = String(body.agent || "").trim();
        if (!agent) {
          return NextResponse.json(
            { error: "agent required" },
            { status: 400 }
          );
        }

        const dbPath = await resolveNamespaceDbPath(agent);
        if (!dbPath) {
          return NextResponse.json(
            { error: `No memory namespace found for agent ${agent}` },
            { status: 404 }
          );
        }

        const resolvedDbPath = resolve(dbPath);
        const allowedRoot = resolve(getOpenClawHome(), "memory");
        const dbDir = dirname(resolvedDbPath);
        if (dbDir !== allowedRoot) {
          return NextResponse.json(
            { error: "Refusing to delete namespace outside the OpenClaw memory directory" },
            { status: 400 }
          );
        }

        const deletedFiles = (
          await Promise.all([
            deleteIfExists(resolvedDbPath).then((ok) => (ok ? resolvedDbPath : null)),
            deleteIfExists(`${resolvedDbPath}-wal`).then((ok) => (ok ? `${resolvedDbPath}-wal` : null)),
            deleteIfExists(`${resolvedDbPath}-shm`).then((ok) => (ok ? `${resolvedDbPath}-shm` : null)),
          ])
        ).filter((value): value is string => Boolean(value));

        if (deletedFiles.length === 0) {
          return NextResponse.json(
            { error: `Namespace files were not found for agent ${agent}` },
            { status: 404 }
          );
        }

        return NextResponse.json({
          ok: true,
          action,
          agent,
          deletedFiles,
        });
      }

      case "setup-memory": {
        // One-click setup: enable memorySearch with given provider/model; optional local model path
        const setupProvider = body.provider as string;
        const setupModel = body.model as string;
        const localModelPath = body.localModelPath as string | undefined;

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

        const memorySearch: Record<string, unknown> = {
          enabled: true,
          provider: setupProvider,
          model: setupModel,
          sources: ["memory"],
        };
        if (setupProvider === "local" && localModelPath?.trim()) {
          memorySearch.local = { modelPath: localModelPath.trim() };
        }
        const referencePaths = await getWorkspaceReferencePaths();
        if (referencePaths.length > 0) {
          memorySearch.extraPaths = referencePaths;
        }

        const setupPatch = JSON.stringify({
          agents: {
            defaults: {
              memorySearch,
            },
          },
        });

        await gatewayCall(
          "config.patch",
          { raw: setupPatch, baseHash: setupHash, restartDelayMs: 2000 },
          15000
        );

        // Trigger initial index (includes extraPaths)
        try {
          await gatewayMemoryIndex();
        } catch {
          // indexing can fail if no memory files yet, that's fine
        }

        return NextResponse.json({ ok: true, action, provider: setupProvider, model: setupModel });
      }

      case "update-embedding-model": {
        // Update embedding provider/model and optional memorySearch options (local path, fallback, cache)
        const provider = body.provider as string;
        const model = body.model as string;
        const localModelPath = body.localModelPath as string | undefined;
        const fallback = body.fallback as string | undefined;
        const cacheEnabled = body.cacheEnabled as boolean | undefined;

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
        const resolved = (configData.resolved || {}) as Record<string, unknown>;
        const agentsConfig = (resolved.agents || {}) as Record<string, unknown>;
        const defaults = (agentsConfig.defaults || {}) as Record<string, unknown>;
        const currentMemorySearch = (defaults.memorySearch || {}) as Record<string, unknown>;

        const memorySearch: Record<string, unknown> = {
          ...currentMemorySearch,
          enabled: currentMemorySearch.enabled ?? true,
          provider,
          model,
          sources: currentMemorySearch.sources ?? ["memory"],
        };
        if (provider === "local" && localModelPath !== undefined) {
          memorySearch.local = {
            ...((currentMemorySearch.local as Record<string, unknown>) || {}),
            modelPath: localModelPath.trim() || undefined,
          };
        }
        if (fallback !== undefined) {
          memorySearch.fallback = fallback === "none" || fallback === "" ? "none" : fallback;
        }
        if (cacheEnabled !== undefined) {
          memorySearch.cache = {
            ...((currentMemorySearch.cache as Record<string, unknown>) || {}),
            enabled: cacheEnabled,
          };
        }
        const existingExtra = (currentMemorySearch.extraPaths as string[] | undefined) ?? [];
        const referencePaths = await getWorkspaceReferencePaths();
        const mergedExtra = [...new Set([...existingExtra, ...referencePaths])];
        if (mergedExtra.length > 0) {
          memorySearch.extraPaths = mergedExtra;
        }

        const patchRaw = JSON.stringify({
          agents: {
            defaults: {
              memorySearch,
            },
          },
        });

        await gatewayCall(
          "config.patch",
          { raw: patchRaw, baseHash: hash },
          15000
        );

        return NextResponse.json({ ok: true, action, provider, model });
      }

      case "ensure-extra-paths": {
        // Merge all root-level .md workspace files into memorySearch.extraPaths and reindex
        const configData = await gatewayCall<Record<string, unknown>>(
          "config.get",
          undefined,
          10000
        );
        const hash = configData.hash as string;
        const resolved = (configData.resolved || {}) as Record<string, unknown>;
        const defaults = (resolved.agents as Record<string, unknown>)?.defaults as Record<string, unknown> | undefined;
        const currentMemorySearch = (defaults?.memorySearch || {}) as Record<string, unknown>;
        const existingExtra = (currentMemorySearch.extraPaths as string[] | undefined) ?? [];
        const referencePaths = await getWorkspaceReferencePaths();
        const mergedExtra = [...new Set([...existingExtra, ...referencePaths])];
        if (mergedExtra.length === 0) {
          return NextResponse.json({ ok: true, action, extraPaths: [], message: "No reference .md files found in workspace root" });
        }
        const memorySearch = {
          ...currentMemorySearch,
          extraPaths: mergedExtra,
        };
        const patchRaw = JSON.stringify({
          agents: {
            defaults: {
              memorySearch,
            },
          },
        });
        await gatewayCall(
          "config.patch",
          { raw: patchRaw, baseHash: hash, restartDelayMs: 2000 },
          15000
        );
        try {
          await gatewayMemoryIndex({ force: true });
        } catch (err) {
          return NextResponse.json(
            { ok: false, action, error: String(err), extraPaths: mergedExtra },
            { status: 500 }
          );
        }
        return NextResponse.json({ ok: true, action, extraPaths: mergedExtra });
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
