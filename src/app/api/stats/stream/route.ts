import { getOpenClawHome, getDefaultWorkspaceSync } from "@/lib/paths";
import { cpus, totalmem, freemem, loadavg, uptime, hostname, platform, arch } from "os";
import { statfs, readdir, stat, readFile } from "fs/promises";
import { join } from "path";

export const dynamic = "force-dynamic";

/* ── TTL Cache ───────────────────────────────────── */

type CacheEntry<T> = { value: T; expiresAt: number };
const cache = new Map<string, CacheEntry<unknown>>();

async function cached<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const existing = cache.get(key) as CacheEntry<T> | undefined;
  if (existing && Date.now() < existing.expiresAt) return existing.value;
  const value = await fn();
  cache.set(key, { value, expiresAt: Date.now() + ttlMs });
  return value;
}

/* ── Helpers ─────────────────────────────────────── */

async function dirSizeBytes(dir: string, maxDepth = 3): Promise<number> {
  let total = 0;
  if (maxDepth <= 0) return 0;
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      const p = join(dir, e.name);
      try {
        if (e.isFile()) {
          const s = await stat(p);
          total += s.size;
        } else if (e.isDirectory() && !e.name.startsWith(".")) {
          total += await dirSizeBytes(p, maxDepth - 1);
        }
      } catch {
        /* skip inaccessible */
      }
    }
  } catch {
    /* dir may not exist */
  }
  return total;
}

async function countFiles(dir: string): Promise<number> {
  try {
    const entries = await readdir(dir, { withFileTypes: true, recursive: true });
    return entries.filter((e) => e.isFile()).length;
  } catch {
    return 0;
  }
}

function formatUptime(secs: number): string {
  const d = Math.floor(secs / 86400);
  const h = Math.floor((secs % 86400) / 3600);
  const m = Math.floor((secs % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

/** CPU usage measured over a ~200ms window. */
async function measureCpuUsage(): Promise<number> {
  const start = cpuSnapshot();
  await new Promise((r) => setTimeout(r, 200));
  const end = cpuSnapshot();

  const idleDiff = end.idle - start.idle;
  const totalDiff = end.total - start.total;
  if (totalDiff === 0) return 0;
  return Math.round(((totalDiff - idleDiff) / totalDiff) * 100);
}

function cpuSnapshot() {
  let idle = 0;
  let total = 0;
  for (const cpu of cpus()) {
    const t = cpu.times;
    idle += t.idle;
    total += t.user + t.nice + t.sys + t.idle + t.irq;
  }
  return { idle, total };
}

async function getLogFileSize(home: string): Promise<number> {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const logFile = join("/tmp/openclaw", `openclaw-${today}.log`);
    const s = await stat(logFile);
    return s.size;
  } catch {
    try {
      const logDir = join(home, "logs");
      const files = await readdir(logDir);
      let biggest = 0;
      for (const f of files) {
        if (f.endsWith(".log")) {
          const s = await stat(join(logDir, f));
          if (s.size > biggest) biggest = s.size;
        }
      }
      return biggest;
    } catch {
      return 0;
    }
  }
}

async function getSessionCount(home: string): Promise<number> {
  let count = 0;
  try {
    const agentsDir = join(home, "agents");
    const agents = await readdir(agentsDir, { withFileTypes: true });
    for (const a of agents) {
      if (!a.isDirectory()) continue;
      const sessionsPath = join(agentsDir, a.name, "sessions", "sessions.json");
      try {
        const raw = await readFile(sessionsPath, "utf-8");
        const data = JSON.parse(raw);
        count += Object.keys(data).length;
      } catch {
        /* skip */
      }
    }
  } catch {
    /* agents dir may not exist */
  }
  return count;
}

async function getProcessCount(): Promise<number> {
  // Use /proc on Linux, rough count on macOS
  try {
    const { execFile } = await import("child_process");
    const { promisify } = await import("util");
    const exec = promisify(execFile);
    const { stdout } = await exec("ps", ["-e", "--no-headers"], {
      timeout: 2000,
    });
    return stdout.trim().split("\n").length;
  } catch {
    try {
      const { execFile } = await import("child_process");
      const { promisify } = await import("util");
      const exec = promisify(execFile);
      // macOS fallback
      const { stdout } = await exec("ps", ["-ax"], { timeout: 2000 });
      return Math.max(0, stdout.trim().split("\n").length - 1); // minus header
    } catch {
      return 0;
    }
  }
}

/* ── Snapshot builder ─────────────────────────────── */

async function buildSnapshot(home: string) {
  const cores = cpus();
  const totalMem = totalmem();
  const freeMem = freemem();
  const usedMem = totalMem - freeMem;
  const load = loadavg();

  // Disk (root filesystem)
  let diskTotal = 0;
  let diskFree = 0;
  let diskUsed = 0;
  try {
    const fs = await statfs("/");
    diskTotal = fs.bsize * fs.blocks;
    diskFree = fs.bsize * fs.bavail;
    diskUsed = diskTotal - diskFree;
  } catch {
    /* statfs not available */
  }

  // CPU usage (measured over 500ms)
  const cpuUsage = await measureCpuUsage();

  // OpenClaw specific stats (run in parallel, with TTL caching)
  const [
    workspaceSize,
    sessionsSize,
    memoryFileCount,
    logSize,
    sessionCount,
    processCount,
  ] = await Promise.all([
    cached("workspaceSize", 60_000, () => dirSizeBytes(getDefaultWorkspaceSync(), 3)),
    cached("sessionsSize", 60_000, () => dirSizeBytes(join(home, "agents"), 2)),
    cached("fileCount", 60_000, () => countFiles(getDefaultWorkspaceSync())),
    cached("logSize", 30_000, () => getLogFileSize(home)),
    cached("sessionCount", 30_000, () => getSessionCount(home)),
    cached("processCount", 15_000, () => getProcessCount()),
  ]);

  return {
    ts: Date.now(),

    // CPU
    cpu: {
      model: cores[0]?.model || "unknown",
      cores: cores.length,
      usage: cpuUsage,
      speed: Math.round(cores[0]?.speed || 0),
      load1: Math.round(load[0] * 100) / 100,
      load5: Math.round(load[1] * 100) / 100,
      load15: Math.round(load[2] * 100) / 100,
    },

    // Memory
    memory: {
      total: totalMem,
      used: usedMem,
      free: freeMem,
      percent: Math.round((usedMem / totalMem) * 100),
    },

    // Disk
    disk: {
      total: diskTotal,
      used: diskUsed,
      free: diskFree,
      percent: diskTotal > 0 ? Math.round((diskUsed / diskTotal) * 100) : 0,
    },

    // System
    system: {
      hostname: hostname(),
      platform: platform(),
      arch: arch(),
      uptime: Math.round(uptime()),
      uptimeDisplay: formatUptime(Math.round(uptime())),
      processCount,
    },

    // OpenClaw
    openclaw: {
      homeDir: home,
      workspaceSizeBytes: workspaceSize,
      sessionsSizeBytes: sessionsSize,
      totalWorkspaceFiles: memoryFileCount,
      logSizeBytes: logSize,
      activeSessions: sessionCount,
    },
  };
}

/* ── SSE endpoint ─────────────────────────────────── */

export async function GET() {
  const home = getOpenClawHome();

  const encoder = new TextEncoder();
  let closed = false;

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        } catch {
          closed = true;
        }
      };

      // Send initial snapshot immediately
      try {
        const snapshot = await buildSnapshot(home);
        send(snapshot);
      } catch (err) {
        send({ error: String(err) });
      }

      // Then send updates every 5 seconds
      const interval = setInterval(async () => {
        if (closed) {
          clearInterval(interval);
          return;
        }
        try {
          const snapshot = await buildSnapshot(home);
          send(snapshot);
        } catch {
          // skip this tick
        }
      }, 5000);

      // Cleanup when client disconnects
      // The controller.close() or an error will set closed = true
      // We also listen for the abort signal via the pull/cancel mechanism
    },
    cancel() {
      closed = true;
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
