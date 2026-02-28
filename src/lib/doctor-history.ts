/**
 * Persistent run history for doctor commands.
 *
 * Storage: $OPENCLAW_HOME/ui/doctor-history.json
 * - Max 50 runs, oldest pruned on save
 * - Raw output truncated to 50 KB per run
 * - Atomic writes (write .tmp, rename)
 */

import { join } from "path";
import { readFile, writeFile, rename, mkdir } from "fs/promises";
import { randomUUID } from "crypto";
import { getOpenClawHome } from "@/lib/paths";
import type { DoctorIssue } from "@/lib/doctor-checks";

const MAX_RUNS = 50;
const MAX_RAW_OUTPUT_BYTES = 50 * 1024; // 50 KB

export type DoctorRunRecord = {
  id: string;
  startedAt: number;
  completedAt: number;
  mode: string;
  exitCode: number;
  summary: { errors: number; warnings: number; healthy: number };
  issues: DoctorIssue[];
  rawOutput: string;
  durationMs: number;
};

type HistoryFile = {
  version: 1;
  runs: DoctorRunRecord[];
};

function historyPath(): string {
  return join(getOpenClawHome(), "ui", "doctor-history.json");
}

async function ensureDir(): Promise<void> {
  const dir = join(getOpenClawHome(), "ui");
  await mkdir(dir, { recursive: true });
}

async function loadHistory(): Promise<HistoryFile> {
  try {
    const raw = await readFile(historyPath(), "utf-8");
    const data = JSON.parse(raw) as HistoryFile;
    if (data.version === 1 && Array.isArray(data.runs)) return data;
  } catch {
    // file missing or corrupt — start fresh
  }
  return { version: 1, runs: [] };
}

async function writeHistory(history: HistoryFile): Promise<void> {
  await ensureDir();
  const path = historyPath();
  const tmp = path + ".tmp." + randomUUID().slice(0, 8);
  await writeFile(tmp, JSON.stringify(history, null, 2), "utf-8");
  await rename(tmp, path);
}

export async function saveDoctorRun(run: DoctorRunRecord): Promise<void> {
  // Truncate raw output
  if (run.rawOutput.length > MAX_RAW_OUTPUT_BYTES) {
    run.rawOutput = run.rawOutput.slice(0, MAX_RAW_OUTPUT_BYTES) + "\n... (truncated)";
  }

  const history = await loadHistory();
  history.runs.unshift(run);

  // Prune oldest beyond limit
  if (history.runs.length > MAX_RUNS) {
    history.runs = history.runs.slice(0, MAX_RUNS);
  }

  await writeHistory(history);
}

export async function listDoctorRuns(
  limit = 20,
  offset = 0
): Promise<{ runs: DoctorRunRecord[]; total: number }> {
  const history = await loadHistory();
  return {
    runs: history.runs.slice(offset, offset + limit),
    total: history.runs.length,
  };
}

export async function deleteDoctorRun(id: string): Promise<boolean> {
  const history = await loadHistory();
  const before = history.runs.length;
  history.runs = history.runs.filter((r) => r.id !== id);
  if (history.runs.length === before) return false;
  await writeHistory(history);
  return true;
}

export async function getLastRunTimestamp(): Promise<number | null> {
  const history = await loadHistory();
  if (history.runs.length === 0) return null;
  return history.runs[0].completedAt;
}

export function createRunId(): string {
  return randomUUID();
}
