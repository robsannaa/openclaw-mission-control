import { runCli } from "@/lib/openclaw-cli";

/**
 * Chat endpoint that sends a message to an OpenClaw agent and returns the response.
 * Works with Vercel AI SDK v5's TextStreamChatTransport.
 *
 * Request body (from AI SDK v5 HttpChatTransport):
 * { id, messages: UIMessage[], agentId, trigger, messageId }
 *
 * Each UIMessage has { id, role, parts: [{ type: 'text', text: '...' }] }
 */
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const messages: {
      role: string;
      parts?: { type: string; text?: string }[];
      content?: string;
    }[] = body.messages || [];
    const agentId: string = body.agentId || "main";

    // Extract the last user message text from parts (v5 format) or content (fallback)
    const lastUserMsg = [...messages].reverse().find((m) => m.role === "user");
    let content = "";
    if (lastUserMsg?.parts) {
      content = lastUserMsg.parts
        .filter((p) => p.type === "text" && p.text)
        .map((p) => p.text)
        .join("");
    } else if (lastUserMsg?.content) {
      content = lastUserMsg.content;
    }

    if (!content.trim()) {
      return new Response("Please send a message.", {
        status: 200,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
    }

    // Build CLI args
    const args = ["agent", "--agent", agentId, "--message", content];

    // Generous timeout - agent responses can take a while with tools, search, etc.
    const output = await runCli(args, 180_000);

    // Return as plain text for TextStreamChatTransport
    return new Response(output.trim(), {
      status: 200,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  } catch (err) {
    console.error("Chat API error:", err);
    const errMsg =
      err instanceof Error ? err.message : "Failed to get agent response";
    return new Response(`Error: ${errMsg}`, {
      status: 200,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }
}
