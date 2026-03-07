import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * POST /api/channels/validate
 *
 * Validates a channel token before saving it to config.
 * Telegram: calls https://api.telegram.org/bot{token}/getMe
 * Discord: calls https://discord.com/api/v10/users/@me
 *
 * Returns { ok: true, botName: "..." } on success.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const channel = body.channel as string;
    const token = (body.token as string || "").trim();

    if (!channel || !token) {
      return NextResponse.json({ error: "channel and token are required" }, { status: 400 });
    }

    if (channel === "telegram") {
      // Basic format check: Telegram tokens look like 123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11
      if (!/^\d+:[A-Za-z0-9_-]+$/.test(token)) {
        return NextResponse.json({
          ok: false,
          error: "Invalid token format. Telegram bot tokens look like 123456789:ABCdefGHIjklMNOpqrSTUvwxYZ",
        });
      }

      const res = await fetch(`https://api.telegram.org/bot${token}/getMe`, {
        signal: AbortSignal.timeout(10000),
      });
      const data = await res.json();
      if (!data.ok || !data.result) {
        return NextResponse.json({
          ok: false,
          error: data.description || "Invalid Telegram bot token. Check with @BotFather.",
        });
      }
      return NextResponse.json({
        ok: true,
        botName: data.result.first_name || data.result.username,
        botUsername: data.result.username,
      });
    }

    if (channel === "discord") {
      const res = await fetch("https://discord.com/api/v10/users/@me", {
        headers: { Authorization: `Bot ${token}` },
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        return NextResponse.json({
          ok: false,
          error: (data as Record<string, string>).message || "Invalid Discord bot token.",
        });
      }
      const data = await res.json();
      return NextResponse.json({
        ok: true,
        botName: data.username || "Discord Bot",
        botUsername: data.username,
      });
    }

    // Unsupported channel — skip validation
    return NextResponse.json({ ok: true, botName: null });
  } catch (err) {
    console.error("Channel validate error:", err);
    return NextResponse.json({
      ok: false,
      error: "Could not validate token. Check your connection and try again.",
    }, { status: 500 });
  }
}
