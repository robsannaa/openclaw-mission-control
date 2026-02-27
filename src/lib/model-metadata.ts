/**
 * Static metadata for popular AI models.
 * Used to show friendly names, descriptions, and context windows
 * instead of raw model keys like "anthropic/claude-sonnet-4-20250514".
 */

export type ModelPricing = {
  inputPer1M: number;
  outputPer1M: number;
  cacheReadPer1M?: number;
  cacheWritePer1M?: number;
};

export type ModelMeta = {
  displayName: string;
  provider: string;
  providerDisplayName: string;
  description: string;
  contextWindow: string;
  priceTier: "$" | "$$" | "$$$";
  pricing?: ModelPricing;
};

const MODEL_META: Record<string, ModelMeta> = {
  // ── Anthropic ──
  "anthropic/claude-opus-4-20250514": {
    displayName: "Claude Opus 4",
    provider: "anthropic",
    providerDisplayName: "Anthropic",
    description: "Most capable model for complex reasoning and analysis",
    contextWindow: "200K",
    priceTier: "$$$",
    pricing: { inputPer1M: 15, outputPer1M: 75, cacheReadPer1M: 1.5, cacheWritePer1M: 18.75 },
  },
  "anthropic/claude-sonnet-4-20250514": {
    displayName: "Claude Sonnet 4",
    provider: "anthropic",
    providerDisplayName: "Anthropic",
    description: "Best balance of intelligence, speed, and cost",
    contextWindow: "200K",
    priceTier: "$$",
    pricing: { inputPer1M: 3, outputPer1M: 15, cacheReadPer1M: 0.3, cacheWritePer1M: 3.75 },
  },
  "anthropic/claude-haiku-3-5-20241022": {
    displayName: "Claude Haiku 3.5",
    provider: "anthropic",
    providerDisplayName: "Anthropic",
    description: "Fast and affordable for routine tasks",
    contextWindow: "200K",
    priceTier: "$",
    pricing: { inputPer1M: 0.8, outputPer1M: 4, cacheReadPer1M: 0.08, cacheWritePer1M: 1 },
  },

  // ── OpenAI ──
  "openai/gpt-4.1": {
    displayName: "GPT-4.1",
    provider: "openai",
    providerDisplayName: "OpenAI",
    description: "Flagship model for complex reasoning",
    contextWindow: "1M",
    priceTier: "$$",
    pricing: { inputPer1M: 2, outputPer1M: 8 },
  },
  "openai/gpt-4.1-mini": {
    displayName: "GPT-4.1 Mini",
    provider: "openai",
    providerDisplayName: "OpenAI",
    description: "Fast, affordable with strong capabilities",
    contextWindow: "1M",
    priceTier: "$",
    pricing: { inputPer1M: 0.4, outputPer1M: 1.6 },
  },
  "openai/gpt-4.1-nano": {
    displayName: "GPT-4.1 Nano",
    provider: "openai",
    providerDisplayName: "OpenAI",
    description: "Fastest and cheapest for simple tasks",
    contextWindow: "1M",
    priceTier: "$",
    pricing: { inputPer1M: 0.1, outputPer1M: 0.4 },
  },
  "openai/gpt-4o": {
    displayName: "GPT-4o",
    provider: "openai",
    providerDisplayName: "OpenAI",
    description: "Versatile multimodal model",
    contextWindow: "128K",
    priceTier: "$$",
    pricing: { inputPer1M: 2.5, outputPer1M: 10 },
  },
  "openai/gpt-4o-mini": {
    displayName: "GPT-4o Mini",
    provider: "openai",
    providerDisplayName: "OpenAI",
    description: "Compact and cost-effective",
    contextWindow: "128K",
    priceTier: "$",
    pricing: { inputPer1M: 0.15, outputPer1M: 0.6 },
  },
  "openai/o3": {
    displayName: "o3",
    provider: "openai",
    providerDisplayName: "OpenAI",
    description: "Advanced reasoning with extended thinking",
    contextWindow: "200K",
    priceTier: "$$$",
    pricing: { inputPer1M: 2, outputPer1M: 8 },
  },
  "openai/o3-mini": {
    displayName: "o3 Mini",
    provider: "openai",
    providerDisplayName: "OpenAI",
    description: "Efficient reasoning model",
    contextWindow: "200K",
    priceTier: "$$",
    pricing: { inputPer1M: 1.1, outputPer1M: 4.4 },
  },
  "openai/o4-mini": {
    displayName: "o4 Mini",
    provider: "openai",
    providerDisplayName: "OpenAI",
    description: "Latest efficient reasoning model",
    contextWindow: "200K",
    priceTier: "$$",
    pricing: { inputPer1M: 1.1, outputPer1M: 4.4 },
  },

  // ── Google ──
  "google/gemini-2.5-pro": {
    displayName: "Gemini 2.5 Pro",
    provider: "google",
    providerDisplayName: "Google",
    description: "Most capable Gemini for complex tasks",
    contextWindow: "1M",
    priceTier: "$$",
    pricing: { inputPer1M: 1.25, outputPer1M: 10 },
  },
  "google/gemini-2.5-flash": {
    displayName: "Gemini 2.5 Flash",
    provider: "google",
    providerDisplayName: "Google",
    description: "Fast and efficient with large context",
    contextWindow: "1M",
    priceTier: "$",
    pricing: { inputPer1M: 0.15, outputPer1M: 0.6 },
  },
  "google/gemini-2.0-flash": {
    displayName: "Gemini 2.0 Flash",
    provider: "google",
    providerDisplayName: "Google",
    description: "Previous gen flash model",
    contextWindow: "1M",
    priceTier: "$",
    pricing: { inputPer1M: 0.1, outputPer1M: 0.4 },
  },

  // ── Groq ──
  "groq/llama-3.3-70b-versatile": {
    displayName: "Llama 3.3 70B",
    provider: "groq",
    providerDisplayName: "Groq",
    description: "Open-source Llama on Groq's fast inference",
    contextWindow: "128K",
    priceTier: "$",
  },
  "groq/llama-3.1-8b-instant": {
    displayName: "Llama 3.1 8B",
    provider: "groq",
    providerDisplayName: "Groq",
    description: "Ultra-fast small model on Groq",
    contextWindow: "128K",
    priceTier: "$",
  },

  // ── xAI ──
  "xai/grok-3": {
    displayName: "Grok 3",
    provider: "xai",
    providerDisplayName: "xAI",
    description: "xAI's flagship reasoning model",
    contextWindow: "131K",
    priceTier: "$$",
  },
  "xai/grok-3-mini": {
    displayName: "Grok 3 Mini",
    provider: "xai",
    providerDisplayName: "xAI",
    description: "Fast and affordable from xAI",
    contextWindow: "131K",
    priceTier: "$",
  },

  // ── Mistral ──
  "mistral/mistral-large-latest": {
    displayName: "Mistral Large",
    provider: "mistral",
    providerDisplayName: "Mistral",
    description: "Mistral's most capable model",
    contextWindow: "128K",
    priceTier: "$$",
  },
  "mistral/mistral-small-latest": {
    displayName: "Mistral Small",
    provider: "mistral",
    providerDisplayName: "Mistral",
    description: "Efficient model for everyday tasks",
    contextWindow: "128K",
    priceTier: "$",
  },

  // ── OpenRouter (common) ──
  "openrouter/anthropic/claude-sonnet-4": {
    displayName: "Claude Sonnet 4 (via OpenRouter)",
    provider: "openrouter",
    providerDisplayName: "OpenRouter",
    description: "Anthropic's Sonnet 4 via OpenRouter",
    contextWindow: "200K",
    priceTier: "$$",
  },
  "openrouter/openai/gpt-4o": {
    displayName: "GPT-4o (via OpenRouter)",
    provider: "openrouter",
    providerDisplayName: "OpenRouter",
    description: "OpenAI's GPT-4o via OpenRouter",
    contextWindow: "128K",
    priceTier: "$$",
  },

  // ── Cerebras ──
  "cerebras/llama-3.3-70b": {
    displayName: "Llama 3.3 70B (Cerebras)",
    provider: "cerebras",
    providerDisplayName: "Cerebras",
    description: "Open-source Llama on Cerebras inference",
    contextWindow: "128K",
    priceTier: "$",
  },
};

/**
 * Look up enriched metadata for a model key.
 * Returns null if no metadata exists (falls back to raw key display).
 * Handles OpenRouter 3-part keys like "openrouter/anthropic/claude-sonnet-4"
 * by first trying direct match, then stripping the "openrouter/" prefix.
 */
export function getModelMeta(key: string): ModelMeta | null {
  // Direct match
  if (MODEL_META[key]) return MODEL_META[key];

  const parts = key.split("/");

  // OpenRouter 3-part key: try "openrouter/provider/model" first,
  // then fall back to "provider/model" to reuse the underlying model's metadata
  if (parts.length === 3 && parts[0] === "openrouter") {
    const underlyingKey = `${parts[1]}/${parts[2]}`;
    if (MODEL_META[underlyingKey]) return MODEL_META[underlyingKey];
    // Also try stripping date suffix on the underlying key
    const stripped = parts[2].replace(/-\d{8}$/, "");
    const candidateKey = `${parts[1]}/${stripped}`;
    if (MODEL_META[candidateKey]) return MODEL_META[candidateKey];
  }

  // Try without date suffix (e.g. "anthropic/claude-sonnet-4-20250514" → "anthropic/claude-sonnet-4")
  if (parts.length === 2) {
    const [provider, name] = parts;
    const stripped = name.replace(/-\d{8}$/, "");
    const candidateKey = `${provider}/${stripped}`;
    if (MODEL_META[candidateKey]) return MODEL_META[candidateKey];
  }

  return null;
}

/**
 * Estimate the USD cost for a set of token counts given a full model key.
 * Returns null if no pricing data is available for the model.
 */
export function estimateCostUsd(
  fullModel: string,
  inputTokens: number,
  outputTokens: number,
  cacheReadTokens = 0,
  cacheWriteTokens = 0,
): number | null {
  const meta = getModelMeta(fullModel);
  if (!meta?.pricing) return null;
  const p = meta.pricing;
  let cost =
    (inputTokens / 1_000_000) * p.inputPer1M +
    (outputTokens / 1_000_000) * p.outputPer1M;
  if (cacheReadTokens > 0 && p.cacheReadPer1M != null) {
    cost += (cacheReadTokens / 1_000_000) * p.cacheReadPer1M;
  }
  if (cacheWriteTokens > 0 && p.cacheWritePer1M != null) {
    cost += (cacheWriteTokens / 1_000_000) * p.cacheWritePer1M;
  }
  return cost;
}

/**
 * Get a friendly display name for a model key.
 * Falls back to extracting the model name from the key.
 */
export function getFriendlyModelName(key: string): string {
  const meta = getModelMeta(key);
  if (meta) return meta.displayName;
  // Fallback: strip provider prefix and clean up
  return key.split("/").pop() || key;
}

/**
 * Known provider display names and their emoji/icon identifiers.
 */
export const PROVIDER_INFO: Record<string, { displayName: string; emoji: string }> = {
  anthropic: { displayName: "Anthropic", emoji: "" },
  openai: { displayName: "OpenAI", emoji: "" },
  google: { displayName: "Google", emoji: "" },
  groq: { displayName: "Groq", emoji: "" },
  xai: { displayName: "xAI", emoji: "" },
  mistral: { displayName: "Mistral", emoji: "" },
  openrouter: { displayName: "OpenRouter", emoji: "" },
  cerebras: { displayName: "Cerebras", emoji: "" },
  huggingface: { displayName: "Hugging Face", emoji: "" },
  minimax: { displayName: "MiniMax", emoji: "" },
  zai: { displayName: "ZAI", emoji: "" },
  ollama: { displayName: "Ollama", emoji: "" },
  lmstudio: { displayName: "LM Studio", emoji: "" },
};

export function getProviderDisplayName(provider: string): string {
  return PROVIDER_INFO[provider]?.displayName || provider;
}
