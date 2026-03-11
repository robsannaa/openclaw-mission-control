import { NextRequest, NextResponse } from "next/server";
import { readFile } from "fs/promises";
import { join } from "path";
import { gatewayCall } from "@/lib/openclaw";
import { patchConfig } from "@/lib/gateway-config";
import { getOpenClawHome } from "@/lib/paths";

export const dynamic = "force-dynamic";

/* ── Helpers ── */

function isRecord(v: unknown): v is Record<string, unknown> {
  return Boolean(v) && typeof v === "object" && !Array.isArray(v);
}

function toStr(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

/* ── Channel catalog (Mission Control supports Telegram + Discord) ── */

const CHANNELS = [
  {
    id: "telegram",
    label: "Telegram",
    icon: "✈️",
    setup: "token" as const,
    tokenLabel: "Bot Token",
    tokenPlaceholder: "123456:ABC-DEF1234ghIkl...",
    hint: "Create a bot with @BotFather in Telegram, then paste the token here.",
    docsUrl: "https://docs.openclaw.ai/channels/telegram",
  },
  {
    id: "discord",
    label: "Discord",
    icon: "💬",
    setup: "token" as const,
    tokenLabel: "Bot Token",
    tokenPlaceholder: "MTIzNDU2Nzg5MDEyMzQ1...",
    hint: "Create a bot in the Discord Developer Portal, enable Message Content Intent, then paste the token.",
    docsUrl: "https://docs.openclaw.ai/channels/discord",
  },
] as const;

const SUPPORTED_CHANNELS = new Set(CHANNELS.map((c) => c.id));

/* ── Read config from disk (fallback when gateway RPC unavailable) ── */

async function readChannelsConfig(): Promise<Record<string, unknown>> {
  const home = getOpenClawHome();
  try {
    const raw = await readFile(join(home, "openclaw.json"), "utf-8");
    const parsed = JSON.parse(raw);
    if (isRecord(parsed) && isRecord(parsed.channels)) return parsed.channels;
  } catch { /* */ }
  return {};
}

/* ── Build channel status from gateway + config ── */

type ChannelStatus = {
  id: string;
  channel: string;
  label: string;
  icon: string;
  setup: "token" | "qr";
  setupType: "qr" | "token" | "cli" | "auto";
  setupCommand: string;
  setupHint: string;
  configHint: string;
  tokenLabel?: string;
  tokenPlaceholder?: string;
  hint: string;
  docsUrl: string;
  enabled: boolean;
  configured: boolean;
  connected: boolean;
  error?: string;
  dmPolicy?: string;
  groupPolicy?: string;
  accounts: string[];
  botUsername?: string;
  statuses: {
    channel: string;
    account: string;
    status: string;
    linked?: boolean;
    connected?: boolean;
    error?: string;
  }[];
};

async function buildChannelStatuses(): Promise<ChannelStatus[]> {
  // Fetch gateway status + config in parallel (5s timeout — keep UI snappy)
  const [statusResult, configResult, diskConfig] = await Promise.all([
    gatewayCall<Record<string, unknown>>("channels.status", {}, 5000).catch(() => ({})),
    gatewayCall<Record<string, unknown>>("config.get", undefined, 5000).catch(() => null),
    readChannelsConfig(),
  ]);

  // Extract channel config from gateway or disk
  const resolved = isRecord(configResult?.resolved) ? configResult.resolved : {};
  const channelsConfig = isRecord(resolved.channels)
    ? resolved.channels
    : diskConfig;

  // Extract runtime status
  const statusAccounts = isRecord(statusResult)
    ? (isRecord(statusResult.channelAccounts) ? statusResult.channelAccounts : {})
    : {};
  const statusChannels = isRecord(statusResult)
    ? (isRecord(statusResult.channels) ? statusResult.channels : {})
    : {};

  return CHANNELS.map((ch) => {
    const conf = isRecord(channelsConfig[ch.id]) ? (channelsConfig[ch.id] as Record<string, unknown>) : null;
    const accountRows = Array.isArray(statusAccounts[ch.id])
      ? (statusAccounts[ch.id] as unknown[]).filter(isRecord)
      : [];
    const chStatus = isRecord(statusChannels[ch.id]) ? (statusChannels[ch.id] as Record<string, unknown>) : null;

    const statuses = accountRows.map((r) => {
      const account = toStr(r.accountId) || "default";
      const connected = r.running === true || r.connected === true || r.linked === true;
      const status =
        toStr(r.status) ||
        (connected ? "connected" : r.configured === true ? "configured" : "stopped");
      const error = toStr(r.lastError);
      return {
        channel: ch.id,
        account,
        status,
        linked: r.linked === true ? true : undefined,
        connected: connected ? true : undefined,
        error,
      };
    });

    if (statuses.length === 0 && isRecord(chStatus)) {
      const connected = chStatus.running === true || chStatus.connected === true;
      statuses.push({
        channel: ch.id,
        account: "default",
        status: connected ? "connected" : chStatus.configured === true ? "configured" : "stopped",
        linked: undefined,
        connected: connected ? true : undefined,
        error: toStr(chStatus.lastError),
      });
    }

    const connected = statuses.some((row) => row.connected === true) || chStatus?.running === true;
    const hasToken = conf ? Boolean(conf.botToken || conf.token) : false;
    const enabled = conf ? conf.enabled !== false : false;
    const configured = enabled && (
      hasToken ||
      connected ||
      accountRows.some((r) => r.configured === true) ||
      chStatus?.configured === true ||
      statuses.length > 0
    );
    const error = statuses.find((r) => typeof r.error === "string" && r.error.trim())?.error;
    const accounts = accountRows.map((r) => toStr(r.accountId) || "default");
    const botUsername =
      accountRows
        .map((r) => toStr(r.botUsername) || toStr(r.username))
        .find((value) => Boolean(value && value.trim())) ||
      undefined;

    return {
      ...ch,
      channel: ch.id,
      setupType: ch.setup,
      setupCommand: `openclaw channels add --channel ${ch.id} --token <TOKEN>`,
      setupHint: ch.hint,
      configHint: "You can reconnect, disconnect, or delete this channel anytime from the Channels page.",
      enabled,
      configured,
      connected,
      error,
      dmPolicy: toStr(conf?.dmPolicy),
      groupPolicy: toStr(conf?.groupPolicy),
      accounts: accounts.length > 0 ? accounts : configured ? ["default"] : [],
      botUsername,
      statuses,
    };
  });
}

/* ── GET /api/channels ── */

export async function GET() {
  try {
    const channels = await buildChannelStatuses();
    return NextResponse.json({ channels });
  } catch (err) {
    console.error("Channels GET error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

/* ── POST /api/channels ── */

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const action = String(body.action || "").trim();
    const channel = String(body.channel || "").trim();

    if (!channel) {
      return NextResponse.json({ error: "channel is required" }, { status: 400 });
    }
    if (!SUPPORTED_CHANNELS.has(channel as (typeof CHANNELS)[number]["id"])) {
      return NextResponse.json({ error: `Unsupported channel: ${channel}` }, { status: 400 });
    }

    switch (action) {
      /* ── Connect (add token) ── */
      case "add":
      case "connect": {
        const token = (body.token as string || "").trim();
        if (!token) {
          return NextResponse.json({ error: "token is required" }, { status: 400 });
        }

        const tokenKey = channel === "telegram" ? "botToken" : "token";
        await patchConfig(
          {
            channels: {
              [channel]: {
                enabled: true,
                [tokenKey]: token,
                dmPolicy: (body.dmPolicy as string) || "pairing",
                groupPolicy: (body.groupPolicy as string) || "disabled",
              },
            },
          },
          { restartDelayMs: 2000 },
        );

        return NextResponse.json({ ok: true, message: `${channel} connected.` });
      }

      /* ── Disconnect (remove channel) ── */
      case "disconnect": {
        // Disable and clear credentials
        const clearPatch: Record<string, unknown> = { enabled: false, dmPolicy: "", groupPolicy: "" };
        if (channel === "telegram") clearPatch.botToken = "";
        if (channel === "discord") clearPatch.token = "";

        await patchConfig(
          { channels: { [channel]: clearPatch } },
          { restartDelayMs: 2000 },
        );

        return NextResponse.json({ ok: true, message: `${channel} disconnected.` });
      }

      /* ── Delete (fully remove channel from config) ── */
      case "delete": {
        // Remove the entire channel config section
        await patchConfig(
          { channels: { [channel]: null } },
          { restartDelayMs: 2000 },
        );

        return NextResponse.json({ ok: true, message: `${channel} removed from configuration.` });
      }

      /* ── Update policy ── */
      case "set-policy": {
        const patch: Record<string, unknown> = {};
        if (body.dmPolicy) patch.dmPolicy = body.dmPolicy;
        if (body.groupPolicy) patch.groupPolicy = body.groupPolicy;
        if (Object.keys(patch).length === 0) {
          return NextResponse.json({ error: "dmPolicy or groupPolicy required" }, { status: 400 });
        }
        await patchConfig(
          { channels: { [channel]: patch } },
          { restartDelayMs: 2000 },
        );
        return NextResponse.json({ ok: true });
      }

      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }
  } catch (err) {
    console.error("Channels POST error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
