import { readFile } from "fs/promises";
import { join } from "path";
import { getOpenClawHome } from "@/lib/paths";

/* ── Types ─────────────────────────────────────── */

export type OpenRouterCredits = {
  total_credits: number;
  total_usage: number;
};

export type OpenRouterActivityRow = {
  date: string;
  model: string;
  provider_name: string;
  usage: number;
  requests: number;
  prompt_tokens: number;
  completion_tokens: number;
  reasoning_tokens: number;
};

export type OpenRouterKeyUsage = {
  key_hash: string;
  label: string;
  usage: number;
  limit: number | null;
  is_free_tier: boolean;
  rate_limit: { requests: number; interval: string } | null;
};

export type OpenRouterBillingData = {
  available: true;
  credits: OpenRouterCredits;
  activity: OpenRouterActivityRow[];
  keys: OpenRouterKeyUsage[];
  fetchedAt: number;
};

export type OpenRouterBillingUnavailable = {
  available: false;
  reason: string;
};

export type OpenRouterBillingResult =
  | OpenRouterBillingData
  | OpenRouterBillingUnavailable;

/* ── .env parser (mirrors web-search/route.ts) ── */

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

/* ── Key resolution ──────────────────────────── */

const OPENCLAW_DIR = getOpenClawHome();

async function resolveManagementKey(): Promise<string | null> {
  // 1. ~/.openclaw/.env
  try {
    const raw = await readFile(join(OPENCLAW_DIR, ".env"), "utf-8");
    const env = parseDotEnv(raw);
    if (env.OPENROUTER_MANAGEMENT_KEY) return env.OPENROUTER_MANAGEMENT_KEY;
  } catch {
    // file missing or unreadable — fall through
  }
  // 2. process.env
  if (process.env.OPENROUTER_MANAGEMENT_KEY) {
    return process.env.OPENROUTER_MANAGEMENT_KEY;
  }
  return null;
}

/* ── In-memory cache ─────────────────────────── */

type CacheEntry<T> = { data: T; expiresAt: number };

const cache: {
  credits?: CacheEntry<OpenRouterCredits>;
  activity?: CacheEntry<OpenRouterActivityRow[]>;
  keys?: CacheEntry<OpenRouterKeyUsage[]>;
} = {};

const CREDITS_TTL = 5 * 60 * 1000; // 5 minutes
const ACTIVITY_TTL = 15 * 60 * 1000; // 15 minutes
const KEYS_TTL = 15 * 60 * 1000; // 15 minutes

function getCached<T>(entry: CacheEntry<T> | undefined): T | null {
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) return null;
  return entry.data;
}

/* ── API calls ───────────────────────────────── */

const OR_BASE = "https://openrouter.ai/api/v1";

async function orFetch<T>(path: string, key: string): Promise<T> {
  const res = await fetch(`${OR_BASE}${path}`, {
    headers: { Authorization: `Bearer ${key}` },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`OpenRouter ${path} returned ${res.status}: ${body.slice(0, 200)}`);
  }
  return (await res.json()) as T;
}

async function fetchCredits(key: string): Promise<OpenRouterCredits> {
  const cached = getCached(cache.credits);
  if (cached) return cached;

  const raw = await orFetch<{ data: OpenRouterCredits }>("/credits", key);
  const data = raw.data ?? (raw as unknown as OpenRouterCredits);
  cache.credits = { data, expiresAt: Date.now() + CREDITS_TTL };
  return data;
}

async function fetchActivity(key: string): Promise<OpenRouterActivityRow[]> {
  const cached = getCached(cache.activity);
  if (cached) return cached;

  const raw = await orFetch<{ data: OpenRouterActivityRow[] }>("/activity", key);
  const data = raw.data ?? (raw as unknown as OpenRouterActivityRow[]);
  cache.activity = { data, expiresAt: Date.now() + ACTIVITY_TTL };
  return data;
}

async function fetchKeyUsage(key: string): Promise<OpenRouterKeyUsage[]> {
  const cached = getCached(cache.keys);
  if (cached) return cached;

  const raw = await orFetch<{ data: OpenRouterKeyUsage[] }>("/keys", key);
  const data = raw.data ?? (raw as unknown as OpenRouterKeyUsage[]);
  cache.keys = { data, expiresAt: Date.now() + KEYS_TTL };
  return data;
}

/* ── Combined fetch ──────────────────────────── */

export async function fetchOpenRouterBilling(): Promise<OpenRouterBillingResult> {
  const key = await resolveManagementKey();
  if (!key) {
    return {
      available: false,
      reason:
        "No OPENROUTER_MANAGEMENT_KEY found. Add it to ~/.openclaw/.env to see real billing data from OpenRouter.",
    };
  }

  try {
    const [credits, activity, keys] = await Promise.all([
      fetchCredits(key),
      fetchActivity(key),
      fetchKeyUsage(key),
    ]);

    return {
      available: true,
      credits,
      activity,
      keys,
      fetchedAt: Date.now(),
    };
  } catch (err) {
    return {
      available: false,
      reason: `OpenRouter API error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
