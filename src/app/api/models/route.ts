import { NextRequest, NextResponse } from "next/server";
import { runCliJson, runCli, gatewayCall } from "@/lib/openclaw-cli";

/* ── Provider → environment variable key mapping ── */
const PROVIDER_ENV_KEYS: Record<string, string> = {
  openai: "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  google: "GEMINI_API_KEY",
  groq: "GROQ_API_KEY",
  xai: "XAI_API_KEY",
  mistral: "MISTRAL_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
  cerebras: "CEREBRAS_API_KEY",
  huggingface: "HUGGINGFACE_HUB_TOKEN",
  zai: "ZAI_API_KEY",
  minimax: "MINIMAX_API_KEY",
};

type ModelInfo = {
  key: string;
  name: string;
  input: string;
  contextWindow: number;
  local: boolean;
  available: boolean;
  tags: string[];
  missing: boolean;
};

type ModelStatus = {
  defaultModel: string;
  resolvedDefault: string;
  fallbacks: string[];
  imageModel: string;
  imageFallbacks: string[];
  aliases: Record<string, string>;
  allowed: string[];
};

/**
 * GET /api/models - Returns model configuration and available models.
 *
 * Query params:
 *   scope=status  - current model config (default)
 *   scope=configured - configured models only
 *   scope=all - all 700+ available models (for the model picker)
 *   agent=<id> - get per-agent model config
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const scope = searchParams.get("scope") || "status";
  const agentId = searchParams.get("agent");

  try {
    if (scope === "status") {
      const args = ["models", "status"];
      if (agentId) args.push("--agent", agentId);
      const status = await runCliJson<ModelStatus>(args, 10000);

      // Also get configured models for display names
      const listArgs = ["models", "list"];
      if (agentId) listArgs.push("--agent", agentId);
      const list = await runCliJson<{ models: ModelInfo[] }>(listArgs, 10000);

      // Get per-agent configs from gateway (non-critical — gracefully degrade)
      let agentsList: { id: string; name: string; modelPrimary: string | null; modelFallbacks: string[] | null; usesDefaults: boolean }[] = [];
      let configHash: string | null = null;
      try {
        const configData = await gatewayCall<Record<string, unknown>>(
          "config.get",
          undefined,
          10000
        );
        configHash = (configData.hash as string) || null;
        // config.get returns { resolved: { agents: { defaults, list } }, parsed: {...}, hash: "..." }
        const resolved = (configData.resolved || {}) as Record<string, unknown>;
        const agentsBlock = (resolved.agents || {}) as Record<string, unknown>;
        agentsList = (
          (agentsBlock.list || []) as Record<string, unknown>[]
        ).map((a) => {
          const agentModel = a.model as
            | string
            | { primary?: string; fallbacks?: string[] }
            | undefined;
          let primary: string | null = null;
          let fallbacks: string[] | null = null;
          if (typeof agentModel === "string") {
            primary = agentModel;
          } else if (agentModel && typeof agentModel === "object") {
            primary = agentModel.primary || null;
            fallbacks = agentModel.fallbacks || null;
          }
          return {
            id: a.id as string,
            name: (a.name as string) || (a.id as string),
            modelPrimary: primary,
            modelFallbacks: fallbacks,
            usesDefaults: !agentModel,
          };
        });
      } catch (gwErr) {
        console.warn("Models API: gateway config.get unavailable, continuing without agent configs:", gwErr);
      }

      return NextResponse.json({
        status,
        models: list.models || [],
        agents: agentsList,
        configHash,
      });
    }

    if (scope === "all") {
      // Fetch models and auth status in parallel
      const [list, statusData] = await Promise.all([
        runCliJson<{ count: number; models: ModelInfo[] }>(
          ["models", "list", "--all"],
          15000
        ),
        runCliJson<Record<string, unknown>>(["models", "status"], 10000).catch(
          () => null
        ),
      ]);

      // Extract auth providers from status
      const auth = (statusData?.auth || {}) as Record<string, unknown>;
      const authProviders = (
        (auth.providers || []) as Array<{
          provider: string;
          effective?: { kind: string; detail: string };
        }>
      ).map((p) => ({
        provider: p.provider,
        authenticated: !!p.effective,
        authKind: p.effective?.kind || null,
      }));

      // Extract OAuth status
      const oauthBlock = (auth.oauth || {}) as Record<string, unknown>;
      const oauthProfiles = (
        (oauthBlock.profiles || []) as Array<{
          provider: string;
          status: string;
          remainingMs?: number;
        }>
      ).map((p) => ({
        provider: p.provider,
        status: p.status,
        remainingMs: p.remainingMs,
      }));

      return NextResponse.json({
        count: list.count,
        models: list.models || [],
        authProviders,
        oauthProfiles,
      });
    }

    // scope=configured
    const args = ["models", "list"];
    if (agentId) args.push("--agent", agentId);
    const list = await runCliJson<{ models: ModelInfo[] }>(args, 10000);
    return NextResponse.json({ models: list.models || [] });
  } catch (err) {
    console.error("Models API GET error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

/**
 * POST /api/models - Apply model changes.
 *
 * Body:
 *   { action: "set-primary", model: "provider/model" }
 *   { action: "set-fallbacks", fallbacks: ["model1", "model2"] }
 *   { action: "add-fallback", model: "provider/model" }
 *   { action: "remove-fallback", model: "provider/model" }
 *   { action: "reorder", primary: "...", fallbacks: [...] }
 *   { action: "set-agent-model", agentId: "...", primary: "...", fallbacks: [...] | null }
 *   { action: "reset-agent-model", agentId: "..." }  // remove per-agent override
 *   { action: "set-alias", alias: "...", model: "..." }
 *   { action: "remove-alias", alias: "..." }
 *   { action: "auth-provider", provider: "...", token: "..." }  // paste API key/token for a provider
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const action = body.action as string;

    switch (action) {
      case "set-primary": {
        await runCli(["models", "set", body.model], 10000);
        return NextResponse.json({ ok: true, action, model: body.model });
      }

      case "add-fallback": {
        await runCli(["models", "fallbacks", "add", body.model], 10000);
        return NextResponse.json({ ok: true, action, model: body.model });
      }

      case "remove-fallback": {
        await runCli(["models", "fallbacks", "remove", body.model], 10000);
        return NextResponse.json({ ok: true, action, model: body.model });
      }

      case "set-fallbacks": {
        // Clear all fallbacks then add in order
        await runCli(["models", "fallbacks", "clear"], 10000);
        for (const fb of body.fallbacks as string[]) {
          await runCli(["models", "fallbacks", "add", fb], 10000);
        }
        return NextResponse.json({ ok: true, action, fallbacks: body.fallbacks });
      }

      case "reorder": {
        // Full reorder: set primary + rebuild fallback list
        if (body.primary) {
          await runCli(["models", "set", body.primary], 10000);
        }
        if (body.fallbacks) {
          await runCli(["models", "fallbacks", "clear"], 10000);
          for (const fb of body.fallbacks as string[]) {
            await runCli(["models", "fallbacks", "add", fb], 10000);
          }
        }
        return NextResponse.json({
          ok: true,
          action,
          primary: body.primary,
          fallbacks: body.fallbacks,
        });
      }

      case "set-agent-model": {
        // Use config.patch to set per-agent model
        const configData = await gatewayCall<Record<string, unknown>>(
          "config.get",
          undefined,
          10000
        );
        const hash = configData.hash as string;
        const parsed = (configData.parsed || {}) as Record<string, unknown>;
        const agents = (parsed.agents || {}) as Record<string, unknown>;
        const list = ((agents.list || []) as Record<string, unknown>[]);
        const agentIdx = list.findIndex((a) => a.id === body.agentId);
        if (agentIdx === -1) {
          return NextResponse.json(
            { error: `Agent ${body.agentId} not found` },
            { status: 404 }
          );
        }

        // Build the model value
        const modelValue =
          body.fallbacks != null
            ? { primary: body.primary, fallbacks: body.fallbacks }
            : body.primary;

        // Patch just this agent's model
        const patchRaw = JSON.stringify({
          agents: {
            list: list.map((a, i) =>
              i === agentIdx ? { ...a, model: modelValue } : a
            ),
          },
        });

        await gatewayCall("config.patch", { raw: patchRaw, baseHash: hash }, 15000);
        return NextResponse.json({
          ok: true,
          action,
          agentId: body.agentId,
          model: modelValue,
        });
      }

      case "reset-agent-model": {
        // Remove per-agent model override (inherit defaults)
        const configData2 = await gatewayCall<Record<string, unknown>>(
          "config.get",
          undefined,
          10000
        );
        const hash2 = configData2.hash as string;
        const parsed2 = (configData2.parsed || {}) as Record<string, unknown>;
        const agents2 = (parsed2.agents || {}) as Record<string, unknown>;
        const list2 = ((agents2.list || []) as Record<string, unknown>[]);
        const agentIdx = list2.findIndex((a) => a.id === body.agentId);
        if (agentIdx === -1) {
          return NextResponse.json(
            { error: `Agent ${body.agentId} not found` },
            { status: 404 }
          );
        }

        const updatedList = list2.map((a, i) => {
          if (i !== agentIdx) return a;
          const { model: __removed, ...rest } = a;
          return rest;
        });

        const patchRaw = JSON.stringify({ agents: { list: updatedList } });
        await gatewayCall("config.patch", { raw: patchRaw, baseHash: hash2 }, 15000);
        return NextResponse.json({ ok: true, action, agentId: body.agentId });
      }

      case "set-alias": {
        await runCli(
          ["models", "aliases", "add", body.alias, body.model],
          10000
        );
        return NextResponse.json({
          ok: true,
          action,
          alias: body.alias,
          model: body.model,
        });
      }

      case "remove-alias": {
        await runCli(["models", "aliases", "remove", body.alias], 10000);
        return NextResponse.json({ ok: true, action, alias: body.alias });
      }

      case "auth-provider": {
        // Paste an API key / token for a provider
        const provider = body.provider as string;
        const token = body.token as string;
        if (!provider || !token) {
          return NextResponse.json(
            { error: "Both provider and token are required" },
            { status: 400 }
          );
        }
        try {
          await runCli(
            ["models", "auth", "paste-token", "--provider", provider],
            15000,
            token // pass token via stdin
          );
          return NextResponse.json({ ok: true, action, provider });
        } catch (pasteErr) {
          // Fallback: try setting the env var directly via config.patch
          try {
            const envKey = PROVIDER_ENV_KEYS[provider];
            if (envKey) {
              const configData = await gatewayCall<Record<string, unknown>>(
                "config.get",
                undefined,
                10000
              );
              const hash = configData.hash as string;
              const patchRaw = JSON.stringify({ env: { [envKey]: token } });
              await gatewayCall("config.patch", { raw: patchRaw, baseHash: hash }, 15000);
              return NextResponse.json({ ok: true, action, provider, method: "env" });
            }
          } catch { /* ignore */ }
          return NextResponse.json(
            { error: `Failed to authenticate ${provider}: ${pasteErr}` },
            { status: 500 }
          );
        }
      }

      default:
        return NextResponse.json(
          { error: `Unknown action: ${action}` },
          { status: 400 }
        );
    }
  } catch (err) {
    console.error("Models API POST error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
