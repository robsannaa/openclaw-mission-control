import { NextRequest, NextResponse } from "next/server";
import { readFile } from "fs/promises";
import { join } from "path";
import { runCli, runCliJson, runCliCaptureBoth, gatewayCall, parseJsonFromCliOutput } from "@/lib/openclaw-cli";
import { getOpenClawHome } from "@/lib/paths";

export const dynamic = "force-dynamic";

type CronJob = {
  id: string;
  agentId: string;
  name: string;
  enabled: boolean;
  schedule: { kind: string; expr?: string; everyMs?: number; tz?: string };
  payload: { kind: string; message?: string };
  delivery: { mode: string; channel?: string; to?: string };
  state: {
    nextRunAtMs?: number;
    lastRunAtMs?: number;
    lastStatus?: string;
    lastDurationMs?: number;
    consecutiveErrors?: number;
    lastError?: string;
  };
  sessionTarget?: string;
};

type CronList = { jobs: CronJob[] };

type CronRunEntry = {
  ts: number;
  jobId: string;
  action: string;
  status: string;
  summary?: string;
  durationMs?: number;
  error?: string;
  sessionId?: string;
  sessionKey?: string;
  runAtMs?: number;
  nextRunAtMs?: number;
};

type GatewayMessage = {
  role?: string;
  content?: Array<{ type?: string; text?: string; [k: string]: unknown }>;
  [k: string]: unknown;
};

function formatChatHistoryAsText(messages: GatewayMessage[]): string {
  const lines: string[] = [];
  for (const msg of messages) {
    const role = (msg.role || "unknown").toLowerCase();
    const parts = Array.isArray(msg.content)
      ? (msg.content as Array<{ type?: string; text?: string }>)
          .filter((c) => c?.type === "text" && typeof c.text === "string")
          .map((c) => (c as { text: string }).text)
      : [];
    const text = parts.join("\n").trim();
    if (!text) continue;
    const label = role === "user" ? "User" : role === "assistant" ? "Assistant" : role;
    lines.push(`[${label}]`);
    lines.push(text);
    lines.push("");
  }
  return lines.join("\n").trim();
}

/**
 * Extract known delivery targets from:
 *   1. Existing cron jobs that already have `delivery.to` set
 *   2. Gateway sessions.list payload (deliveryContext.to and origin.from fields)
 */
async function collectKnownTargets(): Promise<
  { target: string; channel: string; source: string }[]
> {
  const targets: Map<string, { channel: string; source: string }> = new Map();

  // 1. Extract from existing cron jobs
  try {
    const data = await runCliJson<CronList>(["cron", "list", "--all"]);
    for (const job of data.jobs || []) {
      if (job.delivery?.to) {
        const ch = job.delivery.channel || detectChannel(job.delivery.to);
        targets.set(job.delivery.to, { channel: ch, source: `cron: ${job.name}` });
      }
    }
  } catch {
    /* ignore */
  }

  // 2. Scan gateway session list for delivery targets
  try {
    const data = await gatewayCall<{
      sessions?: Array<{
        key?: string;
        deliveryContext?: { channel?: string; to?: string };
        origin?: { from?: string; to?: string; surface?: string };
      }>;
    }>("sessions.list", undefined, 10000);
    for (const sess of data.sessions || []) {
      const key = String(sess.key || "");
      const agentId = key.startsWith("agent:") ? (key.split(":")[1] || "unknown") : "unknown";
      if (sess.deliveryContext?.to) {
        const to = sess.deliveryContext.to;
        const ch = sess.deliveryContext.channel || detectChannel(to);
        if (!targets.has(to)) {
          targets.set(to, { channel: ch, source: `session (${agentId})` });
        }
      }
      if (sess.origin?.from && sess.origin.from !== sess.deliveryContext?.to) {
        const from = sess.origin.from;
        const ch = sess.origin.surface || detectChannel(from);
        if (!targets.has(from)) {
          targets.set(from, { channel: ch, source: `session (${agentId})` });
        }
      }
    }
  } catch {
    /* ignore */
  }

  return Array.from(targets.entries()).map(([target, info]) => ({
    target,
    channel: info.channel,
    source: info.source,
  }));
}

function detectChannel(to: string): string {
  if (to.startsWith("telegram:")) return "telegram";
  if (to.startsWith("discord:")) return "discord";
  if (to.startsWith("+")) return "whatsapp";
  return "";
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const action = searchParams.get("action");
  const jobId = searchParams.get("id");

  try {
    if (action === "runs" && jobId) {
      // Get run history for a specific job
      const limit = searchParams.get("limit") || "10";
      const stdout = await runCli(
        ["cron", "runs", "--id", jobId, "--limit", limit],
        10000
      );
      // Parse the output - it's JSON with "entries" array
      try {
        const data = parseJsonFromCliOutput<{ entries: CronRunEntry[] }>(
          stdout,
          `openclaw cron runs --id ${jobId} --limit ${limit}`
        );
        return NextResponse.json(data);
      } catch {
        // Fallback: return raw text
        return NextResponse.json({ entries: [], raw: stdout });
      }
    }

    // Get the actual session output (agent transcript) for the latest run of a job
    if (action === "runOutput" && jobId) {
      const limit = searchParams.get("limit") || "5";
      const stdout = await runCli(
        ["cron", "runs", "--id", jobId, "--limit", limit],
        10000
      );
      let entries: CronRunEntry[] = [];
      try {
        const data = parseJsonFromCliOutput<{ entries?: CronRunEntry[] }>(
          stdout,
          `openclaw cron runs --id ${jobId} --limit ${limit}`
        );
        entries = data.entries ?? [];
      } catch {
        return NextResponse.json({ output: "" });
      }
      const latestWithSession = entries.find((e) => e.sessionKey);
      if (!latestWithSession?.sessionKey) {
        return NextResponse.json({ output: "" });
      }
      try {
        const history = await gatewayCall<{ messages?: GatewayMessage[] }>(
          "chat.history",
          { sessionKey: latestWithSession.sessionKey, limit: 200 },
          15000
        );
        const messages = history.messages ?? [];
        const output = formatChatHistoryAsText(messages);
        return NextResponse.json({ output });
      } catch {
        return NextResponse.json({ output: "" });
      }
    }

    if (action === "targets") {
      // Collect known delivery targets from sessions + existing cron jobs
      const targets = await collectKnownTargets();
      return NextResponse.json({ targets });
    }

    // Default: list all jobs
    const data = await runCliJson<CronList>(["cron", "list", "--all"]);
    return NextResponse.json(data);
  } catch (err) {
    console.error("Cron GET error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action, id, ...params } = body as {
      action: string;
      id: string;
      [key: string]: unknown;
    };

    if (!action) {
      return NextResponse.json({ error: "action required" }, { status: 400 });
    }

    switch (action) {
      case "enable": {
        if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
        await runCli(["cron", "enable", id]);
        return NextResponse.json({ ok: true, action: "enabled", id });
      }

      case "disable": {
        if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
        await runCli(["cron", "disable", id]);
        return NextResponse.json({ ok: true, action: "disabled", id });
      }

      case "run": {
        if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
        const result = await runCliCaptureBoth(["cron", "run", id], 30000);
        const { stdout, stderr, code } = result;
        const ok = code === 0;
        const outputParts: string[] = [];
        if (!ok) {
          outputParts.push(`Command failed (exit ${code ?? "unknown"}).`);
          if (stderr.trim()) outputParts.push("\nStderr:", stderr.trim());
          if (stdout.trim()) outputParts.push("\nStdout:", stdout.trim());
          // When CLI gives no output, try to show recent gateway log so the user can see what went wrong
          if (!stderr.trim() && !stdout.trim()) {
            try {
              const logPath = join(getOpenClawHome(), "logs", "gateway.log");
              const content = await readFile(logPath, "utf-8").catch(() => "");
              const lines = content.trim().split("\n").filter(Boolean).slice(-25);
              if (lines.length > 0) {
                outputParts.push("\n\nRecent gateway log (last 25 lines):");
                outputParts.push(lines.join("\n"));
              }
            } catch { /* ignore */ }
            outputParts.push("\n\nRun in terminal for full output:");
            outputParts.push(`  openclaw cron run ${id}`);
          }
        }
        const output = ok
          ? (stdout?.trim() || stderr?.trim() || "(no output)")
          : outputParts.join("\n");
        return NextResponse.json({
          ok,
          action: ok ? "triggered" : "failed",
          id,
          output,
          ...(ok ? {} : { error: output }),
        });
      }

      case "delete": {
        if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
        await runCli(["cron", "rm", id]);
        return NextResponse.json({ ok: true, action: "deleted", id });
      }

      case "edit": {
        if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
        const args = ["cron", "edit", id];
        if (params.name) args.push("--name", String(params.name));
        if (params.message) args.push("--message", String(params.message));
        if (params.cron) args.push("--cron", String(params.cron));
        if (params.every) args.push("--every", String(params.every));
        if (params.tz) args.push("--tz", String(params.tz));
        if (params.channel) args.push("--channel", String(params.channel));
        if (params.to) args.push("--to", String(params.to));
        if (params.model) args.push("--model", String(params.model));
        if (params.announce === true) args.push("--announce");
        if (params.announce === false) args.push("--no-deliver");
        await runCli(args, 10000);
        return NextResponse.json({ ok: true, action: "edited", id });
      }

      case "create": {
        // Build `openclaw cron add` command with all provided params
        const args = ["cron", "add"];

        // Required: name
        if (!params.name) return NextResponse.json({ error: "name is required" }, { status: 400 });
        args.push("--name", String(params.name));

        // Optional description
        if (params.description) args.push("--description", String(params.description));

        // Agent
        if (params.agent) args.push("--agent", String(params.agent));

        // Schedule (exactly one of: --cron, --every, --at)
        if (params.scheduleKind === "cron") {
          if (!params.cronExpr) return NextResponse.json({ error: "cron expression is required" }, { status: 400 });
          args.push("--cron", String(params.cronExpr));
        } else if (params.scheduleKind === "every") {
          if (!params.everyInterval) return NextResponse.json({ error: "interval is required" }, { status: 400 });
          args.push("--every", String(params.everyInterval));
        } else if (params.scheduleKind === "at") {
          if (!params.atTime) return NextResponse.json({ error: "time is required" }, { status: 400 });
          args.push("--at", String(params.atTime));
        } else {
          return NextResponse.json({ error: "scheduleKind must be cron, every, or at" }, { status: 400 });
        }

        // Timezone
        if (params.tz) args.push("--tz", String(params.tz));

        // Session target
        if (params.sessionTarget === "isolated") {
          args.push("--session", "isolated");
        } else {
          args.push("--session", "main");
        }

        // Wake mode
        if (params.wakeMode) args.push("--wake", String(params.wakeMode));

        // Payload kind
        if (params.payloadKind === "systemEvent") {
          if (params.message) args.push("--system-event", String(params.message));
        } else {
          // Default: agentTurn
          if (params.message) args.push("--message", String(params.message));
        }

        // Model override
        if (params.model) args.push("--model", String(params.model));

        // Thinking level
        if (params.thinking) args.push("--thinking", String(params.thinking));

        // Delivery
        if (params.deliveryMode === "announce") {
          args.push("--announce");
          if (params.channel) args.push("--channel", String(params.channel));
          if (params.to) args.push("--to", String(params.to));
          if (params.bestEffort) args.push("--best-effort-deliver");
        } else {
          args.push("--no-deliver");
        }

        // Delete after run (for one-shot "at" jobs)
        if (params.deleteAfterRun === true) args.push("--delete-after-run");
        if (params.deleteAfterRun === false) args.push("--keep-after-run");

        // Start disabled
        if (params.disabled === true) args.push("--disabled");

        const stdout = await runCli(args, 15000);

        // Try to extract the created job ID from CLI output
        let createdId: string | null = null;
        try {
          const parsed = parseJsonFromCliOutput<Record<string, unknown>>(
            stdout,
            "openclaw cron add"
          );
          createdId =
            (typeof parsed.id === "string" && parsed.id) ||
            (typeof parsed.jobId === "string" && parsed.jobId) ||
            null;
        } catch {
          // Try to extract UUID from raw output
          const match = stdout.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
          if (match) createdId = match[0];
        }

        return NextResponse.json({ ok: true, action: "created", id: createdId, raw: stdout });
      }

      default:
        return NextResponse.json(
          { error: `Unknown action: ${action}` },
          { status: 400 }
        );
    }
  } catch (err) {
    console.error("Cron POST error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
