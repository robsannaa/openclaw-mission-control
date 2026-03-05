import { NextRequest, NextResponse } from "next/server";
import { getGoogleAccountWatch } from "@/lib/google-integrations-api";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const agentId = request.nextUrl.searchParams.get("agentId");
    return NextResponse.json(await getGoogleAccountWatch(id, agentId), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { ok: false, error: message },
      { status: message.includes("not found") ? 404 : 500 },
    );
  }
}
