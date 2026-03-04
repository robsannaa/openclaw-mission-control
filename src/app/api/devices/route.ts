import { NextRequest, NextResponse } from "next/server";
import { gatewayCall } from "@/lib/openclaw";

type TokenInfo = {
  role: string;
  scopes: string[];
  createdAtMs: number;
  rotatedAtMs?: number;
  lastUsedAtMs: number;
};

type PairedDevice = {
  deviceId: string;
  publicKey: string;
  displayName?: string;
  platform: string;
  clientId: string;
  clientMode: string;
  role: string;
  roles: string[];
  scopes: string[];
  tokens: TokenInfo[];
  createdAtMs: number;
  approvedAtMs: number;
};

type PendingRequest = {
  requestId: string;
  deviceId: string;
  publicKey: string;
  displayName?: string;
  platform: string;
  clientId: string;
  clientMode: string;
  requestedRole: string;
  requestedScopes: string[];
  createdAtMs: number;
  expiresAtMs: number;
};

type DeviceListResult = {
  pending: PendingRequest[];
  paired: PairedDevice[];
};

/**
 * GET /api/devices - List all pending requests and paired devices.
 */
export async function GET() {
  try {
    const data = await gatewayCall<DeviceListResult>("device.pair.list", {}, 15000);

    // Sanitize: strip actual token values, keep metadata
    const paired = (data.paired || []).map((d) => ({
      ...d,
      tokens: (d.tokens || []).map((t) => ({
        role: t.role,
        scopes: t.scopes || [],
        createdAtMs: t.createdAtMs,
        rotatedAtMs: t.rotatedAtMs,
        lastUsedAtMs: t.lastUsedAtMs,
      })),
    }));

    return NextResponse.json({
      pending: data.pending || [],
      paired,
    });
  } catch (err) {
    console.error("Devices API GET error:", err);
    return NextResponse.json({
      pending: [],
      paired: [],
      warning: String(err),
      degraded: true,
    });
  }
}

/**
 * POST /api/devices - Device management actions.
 *
 * Body:
 *   { action: "approve", requestId: "..." }
 *   { action: "reject", requestId: "..." }
 *   { action: "revoke", deviceId: "...", role: "..." }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const action = body.action as string;

    switch (action) {
      case "approve": {
        const requestId = body.requestId as string;
        if (!requestId) {
          return NextResponse.json(
            { error: "requestId is required" },
            { status: 400 }
          );
        }
        const result = await gatewayCall<Record<string, unknown>>(
          "device.pair.approve",
          { requestId },
          15000,
        );
        return NextResponse.json({ ok: true, action, requestId, result });
      }

      case "reject": {
        const requestId = body.requestId as string;
        if (!requestId) {
          return NextResponse.json(
            { error: "requestId is required" },
            { status: 400 }
          );
        }
        const result = await gatewayCall<Record<string, unknown>>(
          "device.pair.reject",
          { requestId },
          15000,
        );
        return NextResponse.json({ ok: true, action, requestId, result });
      }

      case "revoke": {
        const deviceId = body.deviceId as string;
        const role = body.role as string;
        if (!deviceId || !role) {
          return NextResponse.json(
            { error: "deviceId and role are required" },
            { status: 400 }
          );
        }
        const result = await gatewayCall<Record<string, unknown>>(
          "device.token.revoke",
          { deviceId, role },
          15000,
        );
        return NextResponse.json({ ok: true, action, deviceId, role, result });
      }

      default:
        return NextResponse.json(
          { error: `Unknown action: ${action}` },
          { status: 400 }
        );
    }
  } catch (err) {
    console.error("Devices API POST error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
