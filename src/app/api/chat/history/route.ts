import { NextRequest, NextResponse } from "next/server";
import { gatewayCall } from "@/lib/openclaw";

export const dynamic = "force-dynamic";

type ContentPart = {
  type?: string | null;
  text?: string | null;
  thinking?: string | null;
};

type HistoryEntry = {
  role?: string | null;
  content?: ContentPart[] | string | null;
  text?: string | null;
  timestamp?: number | null;
};

type HistoryResult = {
  messages?: HistoryEntry[];
  history?: HistoryEntry[];
  entries?: HistoryEntry[];
};

/** Extract displayable text from a history entry's content field. */
function extractText(entry: HistoryEntry): string {
  // content is an array of parts — extract only type:"text" parts
  if (Array.isArray(entry.content)) {
    return entry.content
      .filter((p) => p.type === "text" && typeof p.text === "string")
      .map((p) => (p.text ?? "").trim())
      .filter(Boolean)
      .join("\n\n");
  }
  // fallback: plain string content or top-level text field
  if (typeof entry.content === "string") return entry.content.trim();
  if (typeof entry.text === "string") return entry.text.trim();
  return "";
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const sessionKey = searchParams.get("sessionKey");

  if (!sessionKey) {
    return NextResponse.json({ error: "sessionKey required" }, { status: 400 });
  }

  try {
    const data = await gatewayCall<HistoryResult>("chat.history", { sessionKey });
    const raw = Array.isArray(data.messages)
      ? data.messages
      : Array.isArray(data.history)
      ? data.history
      : Array.isArray(data.entries)
      ? data.entries
      : [];

    const messages = raw
      // skip tool calls and tool results — only show user/assistant turns
      .filter((entry) => entry.role === "user" || entry.role === "assistant")
      .map((entry) => ({
        role: String(entry.role),
        text: extractText(entry),
      }))
      .filter((m) => m.text.length > 0);

    return NextResponse.json({ messages });
  } catch (err) {
    console.error("chat/history error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
