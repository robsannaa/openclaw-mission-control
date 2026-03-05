import { NextRequest, NextResponse } from "next/server";
import { buildGoogleIntegrationsSnapshot } from "@/lib/google-integrations-api";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: NextRequest) {
  try {
    const agentId = request.nextUrl.searchParams.get("agentId");
    const snapshot = await buildGoogleIntegrationsSnapshot(agentId);
    return NextResponse.json(
      {
        generatedAt: snapshot.generatedAt,
        selectedAgentId: snapshot.selectedAgentId,
        accounts: snapshot.store.accounts,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
