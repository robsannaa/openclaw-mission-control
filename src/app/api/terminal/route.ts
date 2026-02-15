import { NextRequest } from "next/server";
import { spawn, type ChildProcess } from "child_process";
import { getOpenClawHome } from "@/lib/paths";

export const dynamic = "force-dynamic";

/* ── Session store (module-level, persists across requests) ── */

type ShellSession = {
  proc: ChildProcess;
  buffer: string[];
  created: number;
  cwd: string;
  alive: boolean;
  listeners: Set<(chunk: string) => void>;
};

const sessions = new Map<string, ShellSession>();

// Cleanup stale sessions every 5 minutes
if (typeof globalThis !== "undefined") {
  const cleanup = () => {
    const now = Date.now();
    for (const [id, s] of sessions) {
      // Kill sessions older than 30 minutes or dead ones
      if (!s.alive || now - s.created > 30 * 60 * 1000) {
        try { s.proc.kill(); } catch { /* */ }
        sessions.delete(id);
      }
    }
  };
  // Use a global flag to avoid re-registering
  const g = globalThis as unknown as Record<string, unknown>;
  if (!g.__terminalCleanup) {
    g.__terminalCleanup = setInterval(cleanup, 5 * 60 * 1000);
  }
}

function createSession(): string {
  const id = crypto.randomUUID().slice(0, 8);
  const home = getOpenClawHome();
  const shell = process.env.SHELL || "/bin/zsh";

  // Use `script` to create a real PTY wrapper (macOS/Linux).
  // Without a PTY, the shell won't echo typed characters back,
  // won't support arrow keys/tab completion, and won't handle
  // terminal escape sequences properly.
  const isMac = process.platform === "darwin";
  const cmd = isMac ? "script" : "script";
  const args = isMac
    ? ["-q", "/dev/null", shell, "-i"]   // macOS: script -q /dev/null <shell> -i
    : ["-qc", `${shell} -i`, "/dev/null"]; // Linux: script -qc "<shell> -i" /dev/null

  const proc = spawn(cmd, args, {
    cwd: home,
    env: {
      ...process.env,
      TERM: "xterm-256color",
      COLORTERM: "truecolor",
      FORCE_COLOR: "3",
      LANG: "en_US.UTF-8",
      HOME: process.env.HOME || "/tmp",
      CLICOLOR: "1",
      CLICOLOR_FORCE: "1",
    },
    stdio: ["pipe", "pipe", "pipe"],
  });

  const session: ShellSession = {
    proc,
    buffer: [],
    created: Date.now(),
    cwd: home,
    alive: true,
    listeners: new Set(),
  };

  const pushData = (text: string) => {
    // Keep last 5000 lines in buffer for reconnection
    session.buffer.push(text);
    if (session.buffer.length > 5000) session.buffer.shift();
    // Notify all SSE listeners
    for (const fn of session.listeners) {
      try { fn(text); } catch { /* */ }
    }
  };

  proc.stdout?.on("data", (data: Buffer) => pushData(data.toString()));
  proc.stderr?.on("data", (data: Buffer) => pushData(data.toString()));

  proc.on("close", () => {
    session.alive = false;
    pushData("\r\n\x1b[90m[Session ended]\x1b[0m\r\n");
  });

  proc.on("error", (err) => {
    session.alive = false;
    pushData(`\r\n\x1b[31m[Error: ${err.message}]\x1b[0m\r\n`);
  });

  sessions.set(id, session);
  return id;
}

/* ── GET: SSE stream of terminal output ── */

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const action = searchParams.get("action") || "stream";
  const sessionId = searchParams.get("session") || "";

  // List active sessions
  if (action === "list") {
    const list = [...sessions.entries()].map(([id, s]) => ({
      id,
      alive: s.alive,
      created: s.created,
      age: Math.round((Date.now() - s.created) / 1000),
    }));
    return Response.json({ sessions: list });
  }

  // SSE stream
  if (!sessionId || !sessions.has(sessionId)) {
    return Response.json({ error: "Invalid session" }, { status: 404 });
  }

  const session = sessions.get(sessionId)!;
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      // Send buffered output first (for reconnection)
      if (session.buffer.length > 0) {
        const replay = session.buffer.join("");
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ type: "output", text: replay })}\n\n`)
        );
      }

      // Send alive status
      controller.enqueue(
        encoder.encode(`data: ${JSON.stringify({ type: "status", alive: session.alive })}\n\n`)
      );

      // Listen for new output
      const listener = (text: string) => {
        try {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ type: "output", text })}\n\n`)
          );
        } catch {
          session.listeners.delete(listener);
        }
      };

      session.listeners.add(listener);

      // Heartbeat every 15s to keep connection alive
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ type: "ping" })}\n\n`)
          );
        } catch {
          clearInterval(heartbeat);
        }
      }, 15000);

      // Cleanup on abort
      request.signal.addEventListener("abort", () => {
        session.listeners.delete(listener);
        clearInterval(heartbeat);
        try { controller.close(); } catch { /* */ }
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

/* ── POST: create session, send input, resize, kill ── */

export async function POST(request: NextRequest) {
  const body = await request.json();
  const action = body.action as string;

  switch (action) {
    case "create": {
      const id = createSession();
      return Response.json({ ok: true, session: id });
    }

    case "input": {
      const sessionId = body.session as string;
      const data = body.data as string;
      const session = sessions.get(sessionId);
      if (!session || !session.alive) {
        return Response.json({ error: "Session not found or dead" }, { status: 404 });
      }
      session.proc.stdin?.write(data);
      return Response.json({ ok: true });
    }

    case "kill": {
      const sessionId = body.session as string;
      const session = sessions.get(sessionId);
      if (session) {
        try { session.proc.kill(); } catch { /* */ }
        sessions.delete(sessionId);
      }
      return Response.json({ ok: true });
    }

    default:
      return Response.json({ error: `Unknown action: ${action}` }, { status: 400 });
  }
}
