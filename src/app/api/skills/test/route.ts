import { NextRequest, NextResponse } from "next/server";
import { runCli } from "@/lib/openclaw";

export const dynamic = "force-dynamic";

const SAFE_TOKEN_RE = /^[A-Za-z0-9._-]+$/;

type SkillTestRequest = {
  skillName?: string;
  agentId?: string;
  input?: string;
};

function safeToken(raw: string, fallback = ""): string {
  const value = String(raw || "").trim();
  if (!value) return fallback;
  if (!SAFE_TOKEN_RE.test(value)) return "";
  return value;
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as SkillTestRequest;

    const skillName = safeToken(body.skillName || "");
    if (!skillName) {
      return NextResponse.json(
        { ok: false, error: "Valid skillName is required" },
        { status: 400 }
      );
    }

    const agentId = safeToken(body.agentId || "", "main");
    if (!agentId) {
      return NextResponse.json(
        { ok: false, error: "Invalid agentId" },
        { status: 400 }
      );
    }

    const input = String(body.input || "").trim();
    const message = input ? `/skill ${skillName} ${input}` : `/skill ${skillName}`;
    const startedAt = Date.now();

    const output = await runCli(
      ["agent", "--agent", agentId, "--message", message],
      180_000
    );

    return NextResponse.json({
      ok: true,
      skillName,
      agentId,
      message,
      cliCommand: `openclaw agent --agent ${agentId} --message ${JSON.stringify(message)}`,
      output: output.trim(),
      durationMs: Date.now() - startedAt,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { ok: false, error: message || "Skill test failed" },
      { status: 500 }
    );
  }
}
