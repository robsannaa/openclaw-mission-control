import { runCli } from "@/lib/openclaw";

/**
 * Chat endpoint that sends a message to an OpenClaw agent and returns the response.
 * Works with Vercel AI SDK v5's TextStreamChatTransport.
 *
 * Request body: { messages, agentId, model?, ... }
 * Each UIMessage has { id, role, parts: [{ type: 'text', text }, { type: 'file', url, filename }] }
 *
 * File content is only included when it's safe text (no null bytes); binary files get a placeholder
 * so the CLI never receives null bytes in --message.
 */
function dataUrlToSafeMessagePart(
  dataUrl: string,
  filename: string
): string {
  try {
    const base64 = dataUrl.replace(/^data:[^;]+;base64,/, "");
    if (!base64) return `[Attached: ${filename} (empty)]`;
    const buf = Buffer.from(base64, "base64");
    // CLI --message must be a string without null bytes; binary (e.g. PNG) breaks the process
    if (buf.includes(0))
      return `[Attached: ${filename} (binary file - not included in message)]`;
    const text = buf.toString("utf-8");
    return `[Attached: ${filename}]\n${text}`;
  } catch {
    return `[Attached: ${filename} (could not decode)]`;
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const messages: {
      role: string;
      parts?: { type: string; text?: string; url?: string; filename?: string }[];
      content?: string;
    }[] = body.messages || [];
    const agentId: string = body.agentId || "main";
    const model: string | undefined = body.model?.trim() || undefined;

    // Extract the last user message: text parts + file parts (data URLs decoded)
    const lastUserMsg = [...messages].reverse().find((m) => m.role === "user");
    const textParts: string[] = [];
    const fileParts: string[] = [];

    if (lastUserMsg?.parts) {
      for (const p of lastUserMsg.parts) {
        if (p.type === "text" && p.text) {
          textParts.push(p.text);
        } else if (p.type === "file" && p.url) {
          const name = (p.filename || "file").replace(/\s+/g, " ");
          fileParts.push(dataUrlToSafeMessagePart(p.url, name));
        }
      }
    } else if (lastUserMsg?.content) {
      textParts.push(lastUserMsg.content);
    }

    const textBlock = textParts.join("").trim();
    const fileBlock = fileParts.length ? "\n\n" + fileParts.join("\n\n---\n\n") : "";
    const content = (textBlock + fileBlock).trim();

    if (!content) {
      return new Response("Please send a message or attach a file.", {
        status: 200,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
    }

    // Build CLI args: agent, --agent id, --message content, optional --model
    const args = ["agent", "--agent", agentId, "--message", content];
    if (model) args.push("--model", model);

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
