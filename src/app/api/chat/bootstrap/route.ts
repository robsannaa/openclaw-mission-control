import { NextResponse } from "next/server";
import { buildChatBootstrap } from "@/lib/chat-bootstrap";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const payload = await buildChatBootstrap();
    return NextResponse.json(payload, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return NextResponse.json(
      {
        agents: [],
        models: [],
        warnings: [String(error)],
        degraded: true,
      },
      {
        status: 500,
        headers: { "Cache-Control": "no-store" },
      }
    );
  }
}
