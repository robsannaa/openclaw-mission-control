import { NextRequest, NextResponse } from "next/server";
import { runCliJson, runCli, gatewayCall } from "@/lib/openclaw-cli";

export const dynamic = "force-dynamic";

/* ── Types ── */

type ChannelListLegacyItem = {
  channel: string;
  enabled: boolean;
  accounts: string[];
};

type ChannelStatusLegacyItem = {
  channel: string;
  account: string;
  status: string;
  linked?: boolean;
  connected?: boolean;
  error?: string;
};

type ChannelStatusRuntime = {
  channel: string;
  account: string;
  status: string;
  linked?: boolean;
  connected?: boolean;
  error?: string;
};

type NormalizedChannel = {
  channel: string;
  enabled: boolean;
  configured: boolean;
  hasConfig: boolean;
  accounts: string[];
  statuses: ChannelStatusRuntime[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function toStr(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function uniqueStrings(values: Array<string | undefined>): string[] {
  return Array.from(new Set(values.filter((v): v is string => Boolean(v))));
}

function deriveAccountStatus(row: Record<string, unknown>): string {
  if (row.running === true) return "connected";
  if (typeof row.lastError === "string" && row.lastError.trim().length > 0) return "error";
  if (row.enabled === false) return "disabled";
  if (row.configured === false) return "not-configured";
  return "idle";
}

function normalizeChannels(
  channelListRaw: unknown,
  statusRaw: unknown,
  channelsConfig: Record<string, unknown>
): NormalizedChannel[] {
  const listObj = isRecord(channelListRaw) ? channelListRaw : {};
  const statusObj = isRecord(statusRaw) ? statusRaw : {};

  // Legacy schema support:
  // channels list -> { channels: [{ channel, enabled, accounts }] }
  // channels status -> { channels: [{ channel, account, status, ... }] }
  const legacyList = Array.isArray(listObj.channels)
    ? (listObj.channels as unknown[]).filter((row): row is ChannelListLegacyItem => {
        if (!isRecord(row)) return false;
        return typeof row.channel === "string";
      })
    : [];
  if (legacyList.length > 0) {
    const legacyStatuses = Array.isArray(statusObj.channels)
      ? (statusObj.channels as unknown[]).filter((row): row is ChannelStatusLegacyItem => {
          if (!isRecord(row)) return false;
          return typeof row.channel === "string";
        })
      : [];
    return legacyList.map((ch) => {
      const statuses = legacyStatuses.filter((s) => s.channel === ch.channel);
      const hasConfig = Boolean(channelsConfig[ch.channel]);
      const accounts = Array.isArray(ch.accounts) ? ch.accounts.map((a) => String(a)) : [];
      const configured = hasConfig || accounts.length > 0 || statuses.length > 0 || Boolean(ch.enabled);
      return {
        channel: ch.channel,
        enabled: Boolean(ch.enabled),
        configured,
        hasConfig,
        accounts,
        statuses: statuses.map((s) => ({
          channel: s.channel,
          account: s.account,
          status: s.status,
          linked: s.linked,
          connected: s.connected,
          error: s.error,
        })),
      };
    });
  }

  // Modern schema support:
  // channels list -> { chat: { telegram: ["default"] } ... }
  // channels status -> { channels: {...}, channelAccounts: { telegram: [{accountId,...}] } }
  const chatMap = isRecord(listObj.chat) ? listObj.chat : {};
  const statusChannels = isRecord(statusObj.channels) ? statusObj.channels : {};
  const statusAccounts = isRecord(statusObj.channelAccounts) ? statusObj.channelAccounts : {};

  const channelIds = new Set<string>([
    ...Object.keys(chatMap),
    ...Object.keys(statusChannels),
    ...Object.keys(statusAccounts),
    ...Object.keys(channelsConfig),
  ]);

  const out: NormalizedChannel[] = [];
  for (const channel of channelIds) {
    const configEntry = isRecord(channelsConfig[channel]) ? channelsConfig[channel] : undefined;
    const hasConfig = Boolean(configEntry);

    const chatAccounts = Array.isArray(chatMap[channel])
      ? (chatMap[channel] as unknown[]).map((a) => String(a))
      : [];

    const accountRows = Array.isArray(statusAccounts[channel])
      ? (statusAccounts[channel] as unknown[]).filter(isRecord)
      : [];

    const statuses: ChannelStatusRuntime[] = accountRows.map((row) => ({
      channel,
      account: toStr(row.accountId) || "default",
      status: deriveAccountStatus(row),
      linked: row.configured === true,
      connected: row.running === true,
      error: toStr(row.lastError),
    }));

    const statusSummary = isRecord(statusChannels[channel]) ? statusChannels[channel] : {};
    const accountIds = uniqueStrings([
      ...chatAccounts,
      ...statuses.map((s) => s.account),
    ]);

    const enabledFromConfig = hasConfig
      ? ((configEntry as Record<string, unknown>).enabled as boolean | undefined) !== false
      : undefined;

    const enabled =
      typeof enabledFromConfig === "boolean"
        ? enabledFromConfig
        : statuses.some((s) => s.connected || s.status === "idle") ||
          statusSummary.running === true ||
          statusSummary.configured === true ||
          chatAccounts.length > 0;

    const configured =
      hasConfig ||
      statusSummary.configured === true ||
      statuses.some((s) => s.linked || s.connected) ||
      chatAccounts.length > 0;

    out.push({
      channel,
      enabled,
      configured,
      hasConfig,
      accounts: accountIds.length > 0 ? accountIds : configured ? ["default"] : [],
      statuses,
    });
  }

  return out;
}

/**
 * GET /api/channels
 *
 * Query params:
 *   scope=list    - list configured channels (default)
 *   scope=status  - runtime status of all channels
 *   scope=all     - combined: configured channels + status + setup hints
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const scope = searchParams.get("scope") || "list";

  try {
    if (scope === "all" || scope === "list") {
      // Get channel list + status + config in parallel
      const [channelList, statusResult, configResult] = await Promise.all([
        runCliJson<Record<string, unknown>>(["channels", "list"], 10000).catch(() => ({})),
        runCliJson<Record<string, unknown>>(["channels", "status"], 10000).catch(() => ({})),
        gatewayCall<Record<string, unknown>>("config.get", undefined, 10000).catch(() => null),
      ]);

      // Extract channel config from gateway
      const resolved = (configResult?.resolved || {}) as Record<string, unknown>;
      const channelsConfig = (resolved.channels || {}) as Record<string, unknown>;

      // Build enriched channel info from modern + legacy schemas.
      const channels = normalizeChannels(channelList, statusResult, channelsConfig);

      // Also include known channels that might not be in `channels list` yet
      // (user may want to set them up)
      const KNOWN_CHANNELS = [
        {
          channel: "whatsapp",
          label: "WhatsApp",
          icon: "💬",
          setupType: "qr" as const,
          setupCommand: "openclaw channels login --channel whatsapp",
          setupHint: "Requires QR code scan from your phone. Uses WhatsApp Web (Baileys).",
          configHint: "Recommended: use a separate phone number for OpenClaw.",
          docsUrl: "https://docs.openclaw.ai/channels/whatsapp",
        },
        {
          channel: "telegram",
          label: "Telegram",
          icon: "✈️",
          setupType: "token" as const,
          setupCommand: "openclaw channels add --channel telegram --token <BOT_TOKEN>",
          setupHint: "Create a bot via https://t.me/BotFather, then paste the token.",
          configHint: "Fastest channel to set up. Supports groups, topics, inline buttons.",
          tokenLabel: "Bot Token",
          tokenPlaceholder: "123456:ABC-DEF1234ghIkl...",
          docsUrl: "https://docs.openclaw.ai/channels/telegram",
        },
        {
          channel: "discord",
          label: "Discord",
          icon: "🎮",
          setupType: "token" as const,
          setupCommand: "openclaw channels add --channel discord --token <BOT_TOKEN>",
          setupHint: "Create a Discord bot at https://discord.com/developers/applications, then paste the token.",
          configHint: "Supports servers, channels, and DMs.",
          tokenLabel: "Bot Token",
          tokenPlaceholder: "MTIzNDU2Nzg5MDEyMzQ1...",
          docsUrl: "https://docs.openclaw.ai/channels/discord",
        },
        {
          channel: "slack",
          label: "Slack",
          icon: "💼",
          setupType: "token" as const,
          setupCommand: "openclaw channels add --channel slack --token <BOT_TOKEN> --app-token <APP_TOKEN>",
          setupHint: "Create a Slack app at https://api.slack.com/apps with Socket Mode enabled.",
          configHint: "Uses Bolt SDK. Supports workspace apps.",
          tokenLabel: "Bot Token",
          tokenPlaceholder: "xoxb-...",
          docsUrl: "https://docs.openclaw.ai/channels/slack",
        },
        {
          channel: "signal",
          label: "Signal",
          icon: "🔒",
          setupType: "cli" as const,
          setupCommand: "openclaw channels login --channel signal",
          setupHint: "Requires signal-cli to be installed. Privacy-focused.",
          configHint: "Uses signal-cli daemon.",
          docsUrl: "https://docs.openclaw.ai/channels/signal",
        },
        {
          channel: "bluebubbles",
          label: "iMessage",
          icon: "🍎",
          setupType: "token" as const,
          setupCommand: "openclaw channels add --channel bluebubbles --token <PASSWORD>",
          setupHint: "Requires BlueBubbles macOS server running. Enter the server password.",
          configHint: "Recommended for iMessage. Full feature support.",
          tokenLabel: "Server Password",
          tokenPlaceholder: "your-bluebubbles-password",
          docsUrl: "https://docs.openclaw.ai/channels/bluebubbles",
        },
        {
          channel: "mattermost",
          label: "Mattermost",
          icon: "📡",
          setupType: "token" as const,
          setupCommand: "openclaw channels add --channel mattermost --token <BOT_TOKEN>",
          setupHint: "Create a bot in Mattermost and paste the token.",
          configHint: "Bot API + WebSocket. Supports channels, groups, DMs.",
          tokenLabel: "Bot Token",
          tokenPlaceholder: "...",
          docsUrl: "https://docs.openclaw.ai/channels/mattermost",
        },
        {
          channel: "googlechat",
          label: "Google Chat",
          icon: "💬",
          setupType: "cli" as const,
          setupCommand: "openclaw channels add --channel googlechat",
          setupHint: "Requires Google Chat API app configuration.",
          configHint: "Google Chat API app via HTTP webhook.",
          docsUrl: "https://docs.openclaw.ai/channels/googlechat",
        },
        {
          channel: "matrix",
          label: "Matrix",
          icon: "🔗",
          setupType: "cli" as const,
          setupCommand: "openclaw channels add --channel matrix",
          setupHint: "Matrix protocol. Plugin, installed separately.",
          configHint: "Decentralized messaging.",
          docsUrl: "https://docs.openclaw.ai/channels/matrix",
        },
        {
          channel: "irc",
          label: "IRC",
          icon: "📺",
          setupType: "cli" as const,
          setupCommand: "openclaw channels add --channel irc",
          setupHint: "Classic IRC. Channels + DMs with pairing controls.",
          configHint: "",
          docsUrl: "https://docs.openclaw.ai/channels/irc",
        },
        {
          channel: "web",
          label: "WebChat",
          icon: "🌐",
          setupType: "auto" as const,
          setupCommand: "",
          setupHint: "Built-in WebChat over WebSocket. Always available when the Gateway runs.",
          configHint: "No setup needed — works automatically.",
          docsUrl: "https://docs.openclaw.ai/web/webchat",
        },
      ];

      // Merge known channels with live data
      const enriched = KNOWN_CHANNELS.map((known) => {
        const live = channels.find((c) => c.channel === known.channel);
        return {
          ...known,
          enabled: live?.enabled ?? false,
          configured: live?.configured ?? false,
          accounts: live?.accounts ?? [],
          statuses: live?.statuses ?? [],
        };
      });

      // Also include any channels from the CLI that aren't in KNOWN_CHANNELS
      // (plugins, extensions)
      const knownIds = new Set(KNOWN_CHANNELS.map((k) => k.channel));
      const extras = channels
        .filter((c) => !knownIds.has(c.channel))
        .map((c) => ({
          channel: c.channel,
          label: c.channel.charAt(0).toUpperCase() + c.channel.slice(1),
          icon: "📡",
          setupType: "cli" as const,
          setupCommand: `openclaw channels add --channel ${c.channel}`,
          setupHint: "Plugin channel.",
          configHint: "",
          docsUrl: `https://docs.openclaw.ai/channels/${c.channel}`,
          enabled: c.enabled,
          configured: c.configured,
          accounts: c.accounts,
          statuses: c.statuses,
        }));

      return NextResponse.json({ channels: [...enriched, ...extras] });
    }

    // scope=status
    const status = await runCliJson<Record<string, unknown>>(
      ["channels", "status"],
      10000
    );
    return NextResponse.json(status);
  } catch (err) {
    console.error("Channels API GET error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

/**
 * POST /api/channels
 *
 * Body:
 *   { action: "add", channel: "telegram", token: "123:abc" }
 *   { action: "login", channel: "whatsapp", account?: "work" }   -- returns streaming QR/instructions
 *   { action: "logout", channel: "whatsapp", account?: "default" }
 *   { action: "enable", channel: "telegram" }
 *   { action: "disable", channel: "telegram" }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const action = body.action as string;
    const channel = body.channel as string;

    if (!channel) {
      return NextResponse.json({ error: "Channel is required" }, { status: 400 });
    }

    switch (action) {
      case "add": {
        const args = ["channels", "add", "--channel", channel];
        // Token-based channels
        if (body.token) args.push("--token", body.token as string);
        if (body.appToken) args.push("--app-token", body.appToken as string);
        if (body.account) args.push("--account", body.account as string);

        const output = await runCli(args, 30000);
        return NextResponse.json({ ok: true, output: output.trim() });
      }

      case "login": {
        // Login is interactive (QR code for WhatsApp, etc.)
        // We'll stream this. For now, return instructions.
        const args = ["channels", "login", "--channel", channel];
        if (body.account) args.push("--account", body.account as string);

        // For WhatsApp: this spawns an interactive QR code session
        // We need to handle this differently — tell the user to use the Terminal
        if (channel === "whatsapp" || channel === "signal") {
          return NextResponse.json({
            ok: true,
            interactive: true,
            message: `This channel requires interactive login. Run this in the Terminal:\n\nopenclaw channels login --channel ${channel}${body.account ? ` --account ${body.account}` : ""}`,
            command: `openclaw channels login --channel ${channel}${body.account ? ` --account ${body.account}` : ""}`,
          });
        }

        const output = await runCli(args, 30000);
        return NextResponse.json({ ok: true, output: output.trim() });
      }

      case "logout": {
        const args = ["channels", "logout", "--channel", channel];
        if (body.account) args.push("--account", body.account as string);
        const output = await runCli(args, 15000);
        return NextResponse.json({ ok: true, output: output.trim() });
      }

      case "enable": {
        // Enable via config.patch
        const configData = await gatewayCall<Record<string, unknown>>("config.get", undefined, 10000);
        const hash = configData.hash as string;
        const patchRaw = JSON.stringify({
          channels: { [channel]: { enabled: true } },
        });
        await gatewayCall("config.patch", { raw: patchRaw, baseHash: hash, restartDelayMs: 2000 }, 15000);
        return NextResponse.json({ ok: true });
      }

      case "disable": {
        const configData = await gatewayCall<Record<string, unknown>>("config.get", undefined, 10000);
        const hash = configData.hash as string;
        const patchRaw = JSON.stringify({
          channels: { [channel]: { enabled: false } },
        });
        await gatewayCall("config.patch", { raw: patchRaw, baseHash: hash, restartDelayMs: 2000 }, 15000);
        return NextResponse.json({ ok: true });
      }

      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }
  } catch (err) {
    console.error("Channels API POST error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
