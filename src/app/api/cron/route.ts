import { NextRequest, NextResponse } from "next/server";
import { runCli, runCliJson } from "@/lib/openclaw-cli";
import { getOpenClawHome } from "@/lib/paths";
import { readFile, readdir } from "fs/promises";
import { join } from "path";

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

/**
 * Extract known delivery targets from:
 *   1. Existing cron jobs that already have `delivery.to` set
 *   2. Session files on disk (deliveryContext.to and origin.to fields)
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

  // 2. Scan agent session files for deliveryContext.to
  try {
    const home = getOpenClawHome();
    const agentsDir = join(home, "agents");
    const agents = await readdir(agentsDir).catch(() => [] as string[]);

    for (const agentId of agents) {
      const sessPath = join(agentsDir, agentId, "sessions", "sessions.json");
      try {
        const raw = await readFile(sessPath, "utf-8");
        const sessions = JSON.parse(raw) as Record<
          string,
          {
            deliveryContext?: { channel?: string; to?: string };
            origin?: { from?: string; to?: string; surface?: string };
          }
        >;
        for (const [_key, sess] of Object.entries(sessions)) {
          // deliveryContext.to is the most reliable source
          if (sess.deliveryContext?.to) {
            const to = sess.deliveryContext.to;
            const ch = sess.deliveryContext.channel || detectChannel(to);
            if (!targets.has(to)) {
              targets.set(to, { channel: ch, source: `session (${agentId})` });
            }
          }
          // Also check origin.from for additional targets
          if (sess.origin?.from && sess.origin.from !== sess.deliveryContext?.to) {
            const from = sess.origin.from;
            const ch = sess.origin.surface || detectChannel(from);
            if (!targets.has(from)) {
              targets.set(from, { channel: ch, source: `session (${agentId})` });
            }
          }
        }
      } catch {
        // Session file doesn't exist or isn't valid JSON — skip
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
        const data = JSON.parse(stdout) as { entries: CronRunEntry[] };
        return NextResponse.json(data);
      } catch {
        // Fallback: return raw text
        return NextResponse.json({ entries: [], raw: stdout });
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
        await runCli(["cron", "run", id, "--force"], 30000);
        return NextResponse.json({ ok: true, action: "triggered", id });
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
          const parsed = JSON.parse(stdout);
          createdId = parsed.id || parsed.jobId || null;
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
