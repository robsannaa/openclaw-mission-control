import { NextRequest, NextResponse } from "next/server";
import { gatewayCall } from "@/lib/openclaw-cli";

export const dynamic = "force-dynamic";

type Session = {
  key: string;
  kind: string;
  updatedAt: number;
  ageMs: number;
  sessionId: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  model: string;
  contextTokens: number;
};

export async function GET() {
  try {
    const data = await gatewayCall<{
      count: number;
      sessions: Session[];
      defaults: Record<string, unknown>;
    }>("sessions.list");
    return NextResponse.json(data);
  } catch (err) {
    console.error("Sessions GET error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const key = searchParams.get("key");
    if (!key) {
      return NextResponse.json({ error: "session key required" }, { status: 400 });
    }

    const result = await gatewayCall<{
      ok: boolean;
      key: string;
      deleted: boolean;
      archived: string[];
    }>("sessions.delete", { key });

    return NextResponse.json(result);
  } catch (err) {
    console.error("Sessions DELETE error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
