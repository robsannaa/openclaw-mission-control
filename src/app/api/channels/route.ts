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

/* ── Channel catalog (the three we support) ── */

const CHANNELS = [
  {
    id: "telegram",
    label: "Telegram",
    icon: "telegram",
    setup: "token" as const,
    tokenLabel: "Bot Token",
    tokenPlaceholder: "123456:ABC-DEF1234ghIkl...",
    hint: "Create a bot with @BotFather in Telegram, then paste the token here.",
    docsUrl: "https://docs.openclaw.ai/channels/telegram",
  },
  {
    id: "discord",
    label: "Discord",
    icon: "discord",
    setup: "token" as const,
    tokenLabel: "Bot Token",
    tokenPlaceholder: "MTIzNDU2Nzg5MDEyMzQ1...",
    hint: "Create a bot in the Discord Developer Portal, enable Message Content Intent, then paste the token.",
    docsUrl: "https://docs.openclaw.ai/channels/discord",
  },
  {
    id: "whatsapp",
    label: "WhatsApp",
    icon: "whatsapp",
    setup: "qr" as const,
    hint: "Scan a QR code with the WhatsApp app on the phone you want to use.",
    docsUrl: "https://docs.openclaw.ai/channels/whatsapp",
  },
] as const;

/* ── Read config from disk (fallback when gateway RPC unavailable) ── */

async function readChannelsConfig(): Promise<Record<string, unknown>> {
  const home = getOpenClawHome();
  for (const p of [join(home, "openclaw.json"), join(home, ".openclaw", "openclaw.json")]) {
    try {
      const raw = await readFile(p, "utf-8");
      const parsed = JSON.parse(raw);
      if (isRecord(parsed) && isRecord(parsed.channels)) return parsed.channels;
    } catch {
      /* try next */
    }
  }
  return {};
}

/* ── Build channel status from gateway + config ── */

type ChannelStatus = {
  id: string;
  label: string;
  icon: string;
  setup: "token" | "qr";
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

    const connected = accountRows.some((r) => r.running === true) || chStatus?.running === true;
    const hasToken = conf ? Boolean(conf.botToken || conf.token) : false;
    const enabled = conf ? conf.enabled !== false : false;
    const configured = enabled && (
      hasToken ||
      connected ||
      accountRows.some((r) => r.configured === true) ||
      chStatus?.configured === true ||
      (ch.setup === "qr" && accountRows.length > 0)
    );
    const error = accountRows.find((r) => typeof r.lastError === "string" && r.lastError.trim())?.lastError as string | undefined;
    const accounts = accountRows.map((r) => toStr(r.accountId) || "default");

    return {
      ...ch,
      enabled,
      configured,
      connected,
      error,
      dmPolicy: toStr(conf?.dmPolicy),
      groupPolicy: toStr(conf?.groupPolicy),
      accounts: accounts.length > 0 ? accounts : configured ? ["default"] : [],
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
    const action = body.action as string;
    const channel = body.channel as string;

    if (!channel) {
      return NextResponse.json({ error: "channel is required" }, { status: 400 });
    }

    switch (action) {
      /* ── Connect (add token) ── */
      case "connect": {
        const token = (body.token as string || "").trim();
        if (!token && channel !== "whatsapp") {
          return NextResponse.json({ error: "token is required" }, { status: 400 });
        }

        if (channel === "whatsapp") {
          // WhatsApp: enable in config, QR login handled separately by /api/channels/qr
          await patchConfig(
            { channels: { whatsapp: { enabled: true, dmPolicy: "pairing", groupPolicy: "mention" } } },
            { restartDelayMs: 2000 },
          );
          return NextResponse.json({ ok: true, message: "WhatsApp enabled. Use QR login to link your phone." });
        }

        // Write channel config directly via patchConfig rather than
        // shelling out to `openclaw channels add`, which may not recognise
        // newer channel names on older CLI builds.
        const tokenKey = channel === "telegram" ? "botToken" : "token";
        await patchConfig(
          {
            channels: {
              [channel]: {
                enabled: true,
                [tokenKey]: token,
                dmPolicy: (body.dmPolicy as string) || "pairing",
                groupPolicy: (body.groupPolicy as string) || "mention",
              },
            },
          },
          { restartDelayMs: 2000 },
        );

        return NextResponse.json({ ok: true, message: `${channel} connected.` });
      }

      /* ── Disconnect (remove channel) ── */
      case "disconnect": {
        // WhatsApp: logout session first
        if (channel === "whatsapp") {
          try {
            await gatewayCall("channels.logout", { channel }, 15000);
          } catch { /* best effort */ }
        }

        // Disable and clear credentials
        const clearPatch: Record<string, unknown> = { enabled: false, dmPolicy: "", groupPolicy: "" };
        if (channel === "telegram") clearPatch.botToken = "";
        if (channel === "discord") clearPatch.token = "";
        if (channel === "whatsapp") {
          clearPatch.dmPolicy = "";
          clearPatch.groupPolicy = "";
        }

        await patchConfig(
          { channels: { [channel]: clearPatch } },
          { restartDelayMs: 2000 },
        );

        return NextResponse.json({ ok: true, message: `${channel} disconnected.` });
      }

      /* ── Delete (fully remove channel from config) ── */
      case "delete": {
        // WhatsApp: logout session first
        if (channel === "whatsapp") {
          try {
            await gatewayCall("channels.logout", { channel }, 15000);
          } catch { /* best effort */ }
        }

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
