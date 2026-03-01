import { NextRequest, NextResponse } from "next/server";
import { runCliJson, runCli } from "@/lib/openclaw";
import { getOpenClawHome } from "@/lib/paths";
import { readdir, readFile } from "fs/promises";
import { join } from "path";

export const dynamic = "force-dynamic";

/* ── Types ────────────────────────────────────────── */

type DmRequest = {
  channel: string;
  code: string;
  senderId?: string;
  senderName?: string;
  message?: string;
  createdAt?: string;
  expiresAt?: string;
  [key: string]: unknown;
};

type DeviceRequest = {
  requestId: string;
  deviceId?: string;
  displayName?: string;
  platform?: string;
  clientId?: string;
  clientMode?: string;
  role?: string;
  roles?: string[];
  createdAtMs?: number;
  [key: string]: unknown;
};

/* ── GET: list all pending requests ──────────────── */

export async function GET() {
  const home = getOpenClawHome();
  const dmRequests: DmRequest[] = [];
  const deviceRequests: DeviceRequest[] = [];

  // 1. Discover DM pairing channels by scanning credentials dir
  try {
    const credDir = join(home, "credentials");
    const files = await readdir(credDir);
    const pairingFiles = files.filter((f) => f.endsWith("-pairing.json"));

    for (const file of pairingFiles) {
      const channel = file.replace("-pairing.json", "");
      try {
        const raw = await readFile(join(credDir, file), "utf-8");
        const data = JSON.parse(raw);
        // data can be an array of requests or { requests: [...] }
        const requests = Array.isArray(data)
          ? data
          : Array.isArray(data.requests)
          ? data.requests
          : [];

        for (const req of requests) {
          dmRequests.push({
            ...req,
            channel,
            code: req.code || req.pairingCode || "",
          });
        }
      } catch {
        // File may be empty or malformed
      }
    }
  } catch {
    // credentials dir may not exist
  }

  // Also try the CLI for a more authoritative list (telegram is the most common)
  const cliChannels = ["telegram", "whatsapp", "discord", "slack", "signal"];
  for (const ch of cliChannels) {
    try {
      const data = await runCliJson<{ channel: string; requests: DmRequest[] }>(
        ["pairing", "list", ch],
        8000
      );
      for (const req of data.requests || []) {
        // Avoid duplicates (match by code)
        const code = req.code || "";
        if (code && !dmRequests.some((d) => d.code === code && d.channel === ch)) {
          dmRequests.push({ ...req, channel: ch, code });
        }
      }
    } catch {
      // Channel not configured — skip silently
    }
  }

  // 2. Device pairing requests
  try {
    const data = await runCliJson<{
      pending: DeviceRequest[];
      paired: unknown[];
    }>(["devices", "list"], 8000);
    deviceRequests.push(...(data.pending || []));
  } catch {
    // devices command may fail
  }

  return NextResponse.json({
    dm: dmRequests,
    devices: deviceRequests,
    total: dmRequests.length + deviceRequests.length,
  });
}

/* ── POST: approve / reject ──────────────────────── */

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const action = body.action as string;

    switch (action) {
      case "approve-dm": {
        const channel = body.channel as string;
        const code = body.code as string;
        if (!channel || !code) {
          return NextResponse.json(
            { error: "channel and code required" },
            { status: 400 }
          );
        }
        const output = await runCli(
          ["pairing", "approve", channel, code, "--notify"],
          10000
        );
        return NextResponse.json({ ok: true, action, channel, code, output });
      }

      case "approve-device": {
        const requestId = body.requestId as string;
        if (!requestId) {
          return NextResponse.json(
            { error: "requestId required" },
            { status: 400 }
          );
        }
        const output = await runCli(
          ["devices", "approve", requestId],
          10000
        );
        return NextResponse.json({ ok: true, action, requestId, output });
      }

      case "reject-device": {
        const requestId = body.requestId as string;
        if (!requestId) {
          return NextResponse.json(
            { error: "requestId required" },
            { status: 400 }
          );
        }
        const output = await runCli(
          ["devices", "reject", requestId],
          10000
        );
        return NextResponse.json({ ok: true, action, requestId, output });
      }

      default:
        return NextResponse.json(
          { error: `Unknown action: ${action}` },
          { status: 400 }
        );
    }
  } catch (err) {
    console.error("Pairing API POST error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
