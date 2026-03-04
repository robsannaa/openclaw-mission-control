import { NextResponse } from "next/server";
import { getGatewayUrl } from "@/lib/paths";

export const dynamic = "force-dynamic";

/**
 * GET /api/status — lightweight system status check.
 *
 * Returns gateway reachability and transport mode without slow RPC calls.
 * Designed for health-check consumers, uptime monitors, and the frontend
 * status indicator.
 */
export async function GET() {
  const start = Date.now();
  const url = await getGatewayUrl();
  const port = parseInt(new URL(url).port, 10) || 18789;
  const transport = process.env.OPENCLAW_TRANSPORT || "auto";

  let gateway: "online" | "offline" | "degraded" = "offline";

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
    gateway = res.ok ? "online" : "degraded";
  } catch {
    // unreachable
  }

  return NextResponse.json({
    ok: gateway === "online",
    gateway,
    transport,
    port,
    timestamp: new Date().toISOString(),
    latencyMs: Date.now() - start,
  });
}
