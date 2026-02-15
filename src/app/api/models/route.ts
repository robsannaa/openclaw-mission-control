import { NextRequest, NextResponse } from "next/server";
import { runCliJson, runCli, gatewayCall } from "@/lib/openclaw-cli";

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

      // Get per-agent configs from gateway
      const configData = await gatewayCall<Record<string, unknown>>(
        "config.get",
        undefined,
        10000
      );
      // config.get returns { resolved: { agents: { defaults, list } }, parsed: {...}, hash: "..." }
      const resolved = (configData.resolved || {}) as Record<string, unknown>;
      const agentsBlock = (resolved.agents || {}) as Record<string, unknown>;
      const agentsList = (
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

      return NextResponse.json({
        status,
        models: list.models || [],
        agents: agentsList,
        configHash: configData.hash || null,
      });
    }

    if (scope === "all") {
      const list = await runCliJson<{ count: number; models: ModelInfo[] }>(
        ["models", "list", "--all"],
        15000
      );
      return NextResponse.json({
        count: list.count,
        models: list.models || [],
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
          const { model: _removed, ...rest } = a;
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
