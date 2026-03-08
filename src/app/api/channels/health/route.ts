import { NextResponse } from "next/server";
import { gatewayCall } from "@/lib/openclaw";

export const dynamic = "force-dynamic";

/**
 * GET /api/channels/health
 *
 * Checks if the gateway is responsive. Used by the frontend after a
 * config.patch (which restarts the gateway) to know when it's safe to
 * proceed with pairing.
 */
export async function GET() {
  try {
    const result = await gatewayCall<Record<string, unknown>>(
      "channels.status",
      {},
      8000,
    );
    // If we got a response, gateway is up
    const hasChannels = result && typeof result === "object";
    return NextResponse.json({ ok: true, hasChannels });
  } catch {
    return NextResponse.json({ ok: false }, { status: 503 });
  }
}
