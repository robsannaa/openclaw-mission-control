import { NextRequest, NextResponse } from "next/server";
import { recommendAgent } from "@/lib/agent-routing";

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      title?: string;
      description?: string;
      tags?: string[];
    };

    const recommendation = recommendAgent(body || {});

    return NextResponse.json({ ok: true, recommendation });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Failed to recommend agent",
      },
      { status: 500 },
    );
  }
}
