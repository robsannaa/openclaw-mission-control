import { NextRequest, NextResponse } from "next/server";
import { gatewayCall, runCli } from "@/lib/openclaw";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
type JsonObject = { [key: string]: JsonValue };

const NO_STORE_HEADERS = { "Cache-Control": "no-store" } as const;

function jsonNoStore(body: unknown, init?: ResponseInit) {
  return NextResponse.json(body, {
    ...init,
    headers: {
      ...NO_STORE_HEADERS,
      ...(init?.headers || {}),
    },
  });
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function sanitizeJsonValue(value: unknown, depth = 0): JsonValue | undefined {
  if (depth > 12) return undefined;
  if (value === null) return null;
  if (typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : undefined;
  }
  if (Array.isArray(value)) {
    const out: JsonValue[] = [];
    for (const item of value) {
      const next = sanitizeJsonValue(item, depth + 1);
      if (next !== undefined) out.push(next);
    }
    return out;
  }
  if (isRecord(value)) {
    const out: JsonObject = {};
    for (const [k, v] of Object.entries(value)) {
      const next = sanitizeJsonValue(v, depth + 1);
      if (next !== undefined) out[k] = next;
    }
    return out;
  }
  return undefined;
}

function sanitizeJsonObject(value: unknown): JsonObject | null {
  if (!isRecord(value)) return null;
  const sanitized = sanitizeJsonValue(value);
  if (!sanitized || Array.isArray(sanitized) || typeof sanitized !== "object") return null;
  return sanitized as JsonObject;
}

async function gatewayConfigGet(): Promise<Record<string, unknown>> {
  return gatewayCall<Record<string, unknown>>("config.get", undefined, 12000);
}

async function applyConfigPatchWithRetry(
  rawPatch: Record<string, unknown>,
  maxAttempts = 8
): Promise<void> {
  const raw = JSON.stringify(rawPatch);
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const configData = await gatewayConfigGet();
      const hash = String(configData.hash || "");
      if (!hash) throw new Error("Missing config hash");
      await gatewayCall("config.patch", { raw, baseHash: hash }, 15000);
      return;
    } catch (err) {
      lastError = err;
      if (attempt === maxAttempts) throw err;
      await sleep(Math.min(400 * attempt, 2200));
    }
  }

  throw lastError || new Error("Unknown config.patch error");
}

type AgentHeartbeatRow = {
  id: string;
  name: string;
  heartbeat: JsonObject | null;
};

type VisibilityShape = {
  defaults: JsonObject | null;
  channels: Record<string, { heartbeat: JsonObject | null; accounts: Record<string, JsonObject | null> }>;
};

function extractVisibility(parsedChannels: Record<string, unknown>): VisibilityShape {
  const defaultsBlock = isRecord(parsedChannels.defaults) ? parsedChannels.defaults : {};
  const defaultsHeartbeat = sanitizeJsonObject(defaultsBlock.heartbeat);

  const channels: Record<
    string,
    { heartbeat: JsonObject | null; accounts: Record<string, JsonObject | null> }
  > = {};

  for (const [channelName, channelValue] of Object.entries(parsedChannels)) {
    if (channelName === "defaults" || !isRecord(channelValue)) continue;

    const channelHeartbeat = sanitizeJsonObject(channelValue.heartbeat);
    const accountOverrides: Record<string, JsonObject | null> = {};
    const accountsBlock = isRecord(channelValue.accounts) ? channelValue.accounts : {};

    for (const [accountId, accountValue] of Object.entries(accountsBlock)) {
      if (!isRecord(accountValue)) continue;
      const accountHeartbeat = sanitizeJsonObject(accountValue.heartbeat);
      if (accountHeartbeat) {
        accountOverrides[accountId] = accountHeartbeat;
      }
    }

    if (channelHeartbeat || Object.keys(accountOverrides).length > 0) {
      channels[channelName] = {
        heartbeat: channelHeartbeat,
        accounts: accountOverrides,
      };
    }
  }

  return { defaults: defaultsHeartbeat, channels };
}

function buildHeartbeatResponse(configData: Record<string, unknown>) {
  const parsed = isRecord(configData.parsed) ? configData.parsed : {};
  const resolved = isRecord(configData.resolved) ? configData.resolved : {};

  const parsedAgents = isRecord(parsed.agents) ? parsed.agents : {};
  const resolvedAgents = isRecord(resolved.agents) ? resolved.agents : {};
  const parsedDefaults = isRecord(parsedAgents.defaults) ? parsedAgents.defaults : {};
  const resolvedDefaults = isRecord(resolvedAgents.defaults) ? resolvedAgents.defaults : {};

  const defaultsHeartbeat = sanitizeJsonObject(parsedDefaults.heartbeat);
  const effectiveDefaultsHeartbeat =
    sanitizeJsonObject(resolvedDefaults.heartbeat) || defaultsHeartbeat;

  const agentRows: AgentHeartbeatRow[] = [];
  const list = Array.isArray(parsedAgents.list) ? parsedAgents.list : [];
  for (const entry of list) {
    if (!isRecord(entry)) continue;
    const id = String(entry.id || "");
    if (!id) continue;
    agentRows.push({
      id,
      name: String(entry.name || id),
      heartbeat: sanitizeJsonObject(entry.heartbeat),
    });
  }

  const parsedChannels = isRecord(parsed.channels) ? parsed.channels : {};
  const visibility = extractVisibility(parsedChannels);

  return {
    docsUrl: "https://docs.openclaw.ai/gateway/heartbeat#heartbeat",
    defaultsHeartbeat,
    effectiveDefaultsHeartbeat,
    agents: agentRows,
    visibility,
    stats: {
      agentsTotal: agentRows.length,
      agentsWithOverrides: agentRows.filter((a) => Boolean(a.heartbeat)).length,
      channelsWithOverrides: Object.keys(visibility.channels).length,
    },
  };
}

export async function GET() {
  try {
    const configData = await gatewayConfigGet();
    return jsonNoStore({
      ok: true,
      ...buildHeartbeatResponse(configData),
    });
  } catch (err) {
    console.error("Heartbeat GET error:", err);
    return jsonNoStore({
      ok: true,
      docsUrl: "https://docs.openclaw.ai/gateway/heartbeat#heartbeat",
      defaultsHeartbeat: null,
      effectiveDefaultsHeartbeat: null,
      agents: [],
      visibility: { defaults: null, channels: {} },
      stats: {
        agentsTotal: 0,
        agentsWithOverrides: 0,
        channelsWithOverrides: 0,
      },
      warning: String(err),
      degraded: true,
    });
  }
}

type VisibilityPatch = {
  defaults?: JsonObject | null;
  channels?: Record<
    string,
    {
      heartbeat?: JsonObject | null;
      accounts?: Record<string, { heartbeat?: JsonObject | null }>;
    }
  >;
};

function parseVisibilityPatch(input: unknown): VisibilityPatch | null {
  if (!isRecord(input)) return null;

  const out: VisibilityPatch = {};

  if (Object.prototype.hasOwnProperty.call(input, "defaults")) {
    if (input.defaults === null) {
      out.defaults = null;
    } else {
      const defaults = sanitizeJsonObject(input.defaults);
      if (defaults) out.defaults = defaults;
      else return null;
    }
  }

  if (Object.prototype.hasOwnProperty.call(input, "channels")) {
    if (!isRecord(input.channels)) return null;
    const channels: VisibilityPatch["channels"] = {};
    for (const [channel, channelPatch] of Object.entries(input.channels)) {
      if (!isRecord(channelPatch)) return null;
      const next: {
        heartbeat?: JsonObject | null;
        accounts?: Record<string, { heartbeat?: JsonObject | null }>;
      } = {};

      if (Object.prototype.hasOwnProperty.call(channelPatch, "heartbeat")) {
        if (channelPatch.heartbeat === null) {
          next.heartbeat = null;
        } else {
          const hb = sanitizeJsonObject(channelPatch.heartbeat);
          if (!hb) return null;
          next.heartbeat = hb;
        }
      }

      if (Object.prototype.hasOwnProperty.call(channelPatch, "accounts")) {
        if (!isRecord(channelPatch.accounts)) return null;
        const accounts: Record<string, { heartbeat?: JsonObject | null }> = {};
        for (const [accountId, accountPatch] of Object.entries(channelPatch.accounts)) {
          if (!isRecord(accountPatch)) return null;
          const accountNext: { heartbeat?: JsonObject | null } = {};
          if (Object.prototype.hasOwnProperty.call(accountPatch, "heartbeat")) {
            if (accountPatch.heartbeat === null) {
              accountNext.heartbeat = null;
            } else {
              const hb = sanitizeJsonObject(accountPatch.heartbeat);
              if (!hb) return null;
              accountNext.heartbeat = hb;
            }
          }
          accounts[accountId] = accountNext;
        }
        next.accounts = accounts;
      }

      channels[channel] = next;
    }
    out.channels = channels;
  }

  return out;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const action = String(body?.action || "");

    if (!action) {
      return jsonNoStore({ ok: false, error: "action required" }, { status: 400 });
    }

    if (action === "wake-now") {
      const mode =
        body?.mode === "next-heartbeat" ? "next-heartbeat" : "now";
      const text =
        typeof body?.text === "string" && body.text.trim()
          ? body.text.trim()
          : "Check for urgent follow-ups";
      const output = await runCli(
        ["system", "event", "--text", text, "--mode", mode],
        20000
      );
      return jsonNoStore({ ok: true, action, mode, text, output: output.trim() });
    }

    const configData = await gatewayConfigGet();
    const parsed = isRecord(configData.parsed) ? configData.parsed : {};

    if (action === "save-defaults") {
      const heartbeatRaw = body?.heartbeat;
      const heartbeat =
        heartbeatRaw === null ? null : sanitizeJsonObject(heartbeatRaw);
      if (heartbeatRaw !== null && !heartbeat) {
        return jsonNoStore(
          { ok: false, error: "heartbeat must be an object or null" },
          { status: 400 }
        );
      }

      const agentsBlock = isRecord(parsed.agents) ? { ...parsed.agents } : {};
      const defaultsBlock = isRecord(agentsBlock.defaults)
        ? { ...agentsBlock.defaults }
        : {};

      if (heartbeat === null) delete defaultsBlock.heartbeat;
      else defaultsBlock.heartbeat = heartbeat;

      await applyConfigPatchWithRetry({
        agents: {
          ...agentsBlock,
          defaults: defaultsBlock,
        },
      });

      const next = await gatewayConfigGet();
      return jsonNoStore({ ok: true, action, ...buildHeartbeatResponse(next) });
    }

    if (action === "save-agent") {
      const agentId = String(body?.agentId || "").trim();
      if (!agentId) {
        return jsonNoStore({ ok: false, error: "agentId required" }, { status: 400 });
      }
      const heartbeatRaw = body?.heartbeat;
      const heartbeat =
        heartbeatRaw === null ? null : sanitizeJsonObject(heartbeatRaw);
      if (heartbeatRaw !== null && !heartbeat) {
        return jsonNoStore(
          { ok: false, error: "heartbeat must be an object or null" },
          { status: 400 }
        );
      }

      const agentsBlock = isRecord(parsed.agents) ? { ...parsed.agents } : {};
      const list = Array.isArray(agentsBlock.list) ? agentsBlock.list : [];
      let found = false;
      const nextList = list.map((entry) => {
        if (!isRecord(entry)) return entry;
        if (String(entry.id || "") !== agentId) return entry;
        found = true;
        const nextEntry: Record<string, unknown> = { ...entry };
        if (heartbeat === null) delete nextEntry.heartbeat;
        else nextEntry.heartbeat = heartbeat;
        return nextEntry;
      });

      if (!found) {
        return jsonNoStore(
          { ok: false, error: `Agent ${agentId} not found` },
          { status: 404 }
        );
      }

      await applyConfigPatchWithRetry({
        agents: {
          ...agentsBlock,
          list: nextList,
        },
      });

      const next = await gatewayConfigGet();
      return jsonNoStore({ ok: true, action, ...buildHeartbeatResponse(next) });
    }

    if (action === "save-visibility") {
      const patch = parseVisibilityPatch(body?.visibility);
      if (!patch) {
        return jsonNoStore(
          { ok: false, error: "visibility payload is invalid" },
          { status: 400 }
        );
      }

      const channelsBlock = isRecord(parsed.channels) ? { ...parsed.channels } : {};

      if (Object.prototype.hasOwnProperty.call(patch, "defaults")) {
        const defaults = isRecord(channelsBlock.defaults)
          ? { ...channelsBlock.defaults }
          : {};
        if (patch.defaults === null) delete defaults.heartbeat;
        else if (patch.defaults) defaults.heartbeat = patch.defaults;
        channelsBlock.defaults = defaults;
      }

      if (patch.channels) {
        for (const [channelName, channelPatch] of Object.entries(patch.channels)) {
          const existingChannel = isRecord(channelsBlock[channelName])
            ? { ...(channelsBlock[channelName] as Record<string, unknown>) }
            : {};

          if (Object.prototype.hasOwnProperty.call(channelPatch, "heartbeat")) {
            if (channelPatch.heartbeat === null) {
              delete existingChannel.heartbeat;
            } else if (channelPatch.heartbeat) {
              existingChannel.heartbeat = channelPatch.heartbeat;
            }
          }

          if (channelPatch.accounts) {
            const existingAccounts = isRecord(existingChannel.accounts)
              ? { ...(existingChannel.accounts as Record<string, unknown>) }
              : {};

            for (const [accountId, accountPatch] of Object.entries(channelPatch.accounts)) {
              const existingAccount = isRecord(existingAccounts[accountId])
                ? { ...(existingAccounts[accountId] as Record<string, unknown>) }
                : {};

              if (Object.prototype.hasOwnProperty.call(accountPatch, "heartbeat")) {
                if (accountPatch.heartbeat === null) {
                  delete existingAccount.heartbeat;
                } else if (accountPatch.heartbeat) {
                  existingAccount.heartbeat = accountPatch.heartbeat;
                }
              }

              existingAccounts[accountId] = existingAccount;
            }

            existingChannel.accounts = existingAccounts;
          }

          channelsBlock[channelName] = existingChannel;
        }
      }

      await applyConfigPatchWithRetry({ channels: channelsBlock });

      const next = await gatewayConfigGet();
      return jsonNoStore({ ok: true, action, ...buildHeartbeatResponse(next) });
    }

    return jsonNoStore(
      { ok: false, error: `Unknown action: ${action}` },
      { status: 400 }
    );
  } catch (err) {
    console.error("Heartbeat POST error:", err);
    return jsonNoStore({ ok: false, error: String(err) }, { status: 500 });
  }
}
