/**
 * Server-only: fetches model pricing from OpenRouter's /api/v1/models
 * and returns a Map keyed by OpenRouter model ID (e.g. "moonshotai/kimi-k2.5").
 */

import { readFile } from "fs/promises";
import { join } from "path";
import { getOpenClawHome } from "@/lib/paths";
import type { ModelPricing } from "@/lib/model-metadata";

/* ── .env parser ──────────────────────────────────── */

function parseDotEnv(content: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const line of content.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq < 1) continue;
    const key = t.slice(0, eq).trim();
    let val = t.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    env[key] = val;
  }
  return env;
}

/* ── Key resolution ───────────────────────────────── */

async function resolveOpenRouterApiKey(): Promise<string | null> {
  const homeDir = getOpenClawHome();
  try {
    const raw = await readFile(join(homeDir, ".env"), "utf-8");
    const env = parseDotEnv(raw);
    if (env.OPENROUTER_API_KEY) return env.OPENROUTER_API_KEY;
    if (env.OPENROUTER_MANAGEMENT_KEY) return env.OPENROUTER_MANAGEMENT_KEY;
  } catch {
    // file missing or unreadable
  }
  if (process.env.OPENROUTER_API_KEY) return process.env.OPENROUTER_API_KEY;
  if (process.env.OPENROUTER_MANAGEMENT_KEY) return process.env.OPENROUTER_MANAGEMENT_KEY;
  return null;
}

/* ── Cached fetch ─────────────────────────────────── */

type OpenRouterModelEntry = {
  id: string;
  pricing?: { prompt?: string; completion?: string };
};

let cachedMap: Map<string, ModelPricing> = new Map();
let fetchedAt = 0;
const TTL = 30 * 60 * 1000; // 30 minutes

/**
 * Fetch model pricing from OpenRouter's /api/v1/models endpoint.
 * Returns a Map<modelId, ModelPricing> with 30-minute caching.
 * Returns an empty map if no API key is available or the request fails.
 */
export async function fetchOpenRouterPricing(): Promise<Map<string, ModelPricing>> {
  if (Date.now() - fetchedAt < TTL && cachedMap.size > 0) return cachedMap;

  const key = await resolveOpenRouterApiKey();
  if (!key) return cachedMap;

  try {
    const res = await fetch("https://openrouter.ai/api/v1/models", {
      headers: { Authorization: `Bearer ${key}` },
    });
    if (!res.ok) return cachedMap;

    const json = (await res.json()) as { data?: OpenRouterModelEntry[] };
    const models = json.data;
    if (!Array.isArray(models)) return cachedMap;

    const newMap = new Map<string, ModelPricing>();
    for (const m of models) {
      const prompt = m.pricing?.prompt;
      const completion = m.pricing?.completion;
      if (!prompt || !completion) continue;
      const inputPer1M = parseFloat(prompt) * 1_000_000;
      const outputPer1M = parseFloat(completion) * 1_000_000;
      if (!Number.isFinite(inputPer1M) || !Number.isFinite(outputPer1M)) continue;
      newMap.set(m.id, { inputPer1M, outputPer1M });
    }
    cachedMap = newMap;
    fetchedAt = Date.now();
  } catch {
    // Network error — return whatever we have cached
  }

  return cachedMap;
}
