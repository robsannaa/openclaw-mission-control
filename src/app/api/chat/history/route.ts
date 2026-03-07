import { NextRequest, NextResponse } from "next/server";
import { gatewayCall } from "@/lib/openclaw";

export const dynamic = "force-dynamic";

type HistoryEntry = {
  role?: string | null;
  text?: string | null;
  content?: string | null;
  message?: string | null;
};

type HistoryResult = {
  messages?: HistoryEntry[];
  history?: HistoryEntry[];
  entries?: HistoryEntry[];
};

function extractText(entry: HistoryEntry): string {
  return String(entry.text ?? entry.content ?? entry.message ?? "").trim();
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const sessionKey = searchParams.get("sessionKey");

  if (!sessionKey) {
    return NextResponse.json({ error: "sessionKey required" }, { status: 400 });
  }

  try {
    const data = await gatewayCall<HistoryResult>("chat.history", { sessionKey });
    const raw = data.messages ?? data.history ?? data.entries ?? [];
    const messages = raw
      .map((entry) => ({
        role: String(entry.role ?? "user"),
        text: extractText(entry),
      }))
      .filter((m) => m.text.length > 0);

    return NextResponse.json({ messages });
  } catch (err) {
    console.error("chat/history error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
