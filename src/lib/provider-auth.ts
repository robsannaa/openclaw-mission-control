type ProviderProbe = {
  url: string;
  method: "GET" | "POST";
  buildHeaders: (token: string) => Record<string, string>;
  buildBody?: () => string;
  authErrorStatuses?: number[];
  treatClientErrorAsReachable?: boolean;
};

type ModelListConfig = {
  url: string;
  buildHeaders: (token: string) => Record<string, string>;
  buildUrl?: (token: string) => string;
  fallbackModels?: ProviderModelItem[];
};

export type ProviderModelItem = { id: string; name: string };

export const PROVIDER_ENV_KEYS: Record<string, string> = {
  openai: "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  google: "GEMINI_API_KEY",
  groq: "GROQ_API_KEY",
  xai: "XAI_API_KEY",
  mistral: "MISTRAL_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
  cerebras: "CEREBRAS_API_KEY",
  huggingface: "HUGGINGFACE_HUB_TOKEN",
  zai: "ZAI_API_KEY",
  minimax: "MINIMAX_API_KEY",
};

export const MINIMAX_PROVIDER_MODELS: ProviderModelItem[] = [
  { id: "minimax/MiniMax-M2.5", name: "MiniMax M2.5" },
  { id: "minimax/MiniMax-M2.5-highspeed", name: "MiniMax M2.5 High-Speed" },
  { id: "minimax/MiniMax-M2.1", name: "MiniMax M2.1" },
  { id: "minimax/MiniMax-M2.1-highspeed", name: "MiniMax M2.1 High-Speed" },
  { id: "minimax/MiniMax-M2", name: "MiniMax M2" },
];

export const MINIMAX_PROVIDER_CONFIG = {
  baseUrl: "https://api.minimax.io/anthropic",
  api: "anthropic-messages",
  apiKey: "${MINIMAX_API_KEY}",
  models: MINIMAX_PROVIDER_MODELS.map((model) => ({
    id: model.id.replace(/^minimax\//, ""),
    name: model.name,
  })),
};

const PROVIDER_PROBES: Record<string, ProviderProbe> = {
  openai: {
    url: "https://api.openai.com/v1/models",
    method: "GET",
    buildHeaders: (token) => ({ Authorization: `Bearer ${token}` }),
  },
  anthropic: {
    url: "https://api.anthropic.com/v1/messages",
    method: "POST",
    buildHeaders: (token) => ({
      "x-api-key": token,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    }),
    buildBody: () =>
      JSON.stringify({
        model: "claude-haiku-3-5-20241022",
        max_tokens: 1,
        messages: [{ role: "user", content: "hi" }],
      }),
    authErrorStatuses: [401, 403],
    treatClientErrorAsReachable: true,
  },
  google: {
    url: "https://generativelanguage.googleapis.com/v1beta/models",
    method: "GET",
    buildHeaders: () => ({}),
  },
  openrouter: {
    url: "https://openrouter.ai/api/v1/models",
    method: "GET",
    buildHeaders: (token) => ({ Authorization: `Bearer ${token}` }),
  },
  groq: {
    url: "https://api.groq.com/openai/v1/models",
    method: "GET",
    buildHeaders: (token) => ({ Authorization: `Bearer ${token}` }),
  },
  xai: {
    url: "https://api.x.ai/v1/models",
    method: "GET",
    buildHeaders: (token) => ({ Authorization: `Bearer ${token}` }),
  },
  mistral: {
    url: "https://api.mistral.ai/v1/models",
    method: "GET",
    buildHeaders: (token) => ({ Authorization: `Bearer ${token}` }),
  },
  cerebras: {
    url: "https://api.cerebras.ai/v1/models",
    method: "GET",
    buildHeaders: (token) => ({ Authorization: `Bearer ${token}` }),
  },
  huggingface: {
    url: "https://router.huggingface.co/v1/models",
    method: "GET",
    buildHeaders: (token) => ({ Authorization: `Bearer ${token}` }),
  },
  zai: {
    url: "https://api.z.ai/api/paas/v4/models",
    method: "GET",
    buildHeaders: (token) => ({ Authorization: `Bearer ${token}` }),
  },
  minimax: {
    url: "https://api.minimax.io/anthropic/v1/messages",
    method: "POST",
    buildHeaders: (token) => ({
      Authorization: `Bearer ${token}`,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    }),
    buildBody: () =>
      JSON.stringify({
        model: "MiniMax-M2.1",
        max_tokens: 1,
        messages: [{ role: "user", content: "hi" }],
      }),
    authErrorStatuses: [401, 403],
    treatClientErrorAsReachable: true,
  },
};

const MODEL_LIST_CONFIG: Record<string, ModelListConfig> = {
  openai: {
    url: "https://api.openai.com/v1/models",
    buildHeaders: (token) => ({ Authorization: `Bearer ${token}` }),
  },
  anthropic: {
    url: "https://api.anthropic.com/v1/models",
    buildHeaders: (token) => ({
      "x-api-key": token,
      "anthropic-version": "2023-06-01",
    }),
  },
  google: {
    url: "https://generativelanguage.googleapis.com/v1beta/models",
    buildHeaders: () => ({}),
    buildUrl: (token) =>
      `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(token)}`,
  },
  openrouter: {
    url: "https://openrouter.ai/api/v1/models",
    buildHeaders: (token) => ({ Authorization: `Bearer ${token}` }),
  },
  groq: {
    url: "https://api.groq.com/openai/v1/models",
    buildHeaders: (token) => ({ Authorization: `Bearer ${token}` }),
  },
  xai: {
    url: "https://api.x.ai/v1/models",
    buildHeaders: (token) => ({ Authorization: `Bearer ${token}` }),
  },
  mistral: {
    url: "https://api.mistral.ai/v1/models",
    buildHeaders: (token) => ({ Authorization: `Bearer ${token}` }),
  },
  cerebras: {
    url: "https://api.cerebras.ai/v1/models",
    buildHeaders: (token) => ({ Authorization: `Bearer ${token}` }),
  },
  huggingface: {
    url: "https://router.huggingface.co/v1/models",
    buildHeaders: (token) => ({ Authorization: `Bearer ${token}` }),
  },
  zai: {
    url: "https://api.z.ai/api/paas/v4/models",
    buildHeaders: (token) => ({ Authorization: `Bearer ${token}` }),
  },
  minimax: {
    url: "https://api.minimax.io/v1/models",
    buildHeaders: (token) => ({ Authorization: `Bearer ${token}` }),
    fallbackModels: MINIMAX_PROVIDER_MODELS,
  },
};

function parseStandardDataModels(provider: string, data: unknown): ProviderModelItem[] {
  const rows =
    data && typeof data === "object" && Array.isArray((data as { data?: unknown[] }).data)
      ? (data as { data: Array<{ id?: string; name?: string }> }).data
      : [];

  return rows
    .map((row) => {
      const rawId = String(row?.id || "").trim();
      if (!rawId) return null;
      return {
        id: rawId.startsWith(`${provider}/`) ? rawId : `${provider}/${rawId}`,
        name: String(row?.name || rawId),
      };
    })
    .filter((row): row is ProviderModelItem => row !== null);
}

function truncateProviderError(body: string): string {
  const trimmed = body.trim();
  if (!trimmed) return "";
  return trimmed.length > 200 ? `${trimmed.slice(0, 200)}...` : trimmed;
}

export async function validateProviderToken(
  provider: string,
  token: string,
): Promise<{ ok: boolean; error?: string }> {
  const providerId = String(provider || "").trim().toLowerCase();
  const apiKey = String(token || "").trim();
  const probe = PROVIDER_PROBES[providerId];

  if (!providerId || !apiKey) {
    return { ok: false, error: "Provider and token are required" };
  }
  if (!probe) {
    return { ok: false, error: `Unknown provider: ${providerId}` };
  }

  const url =
    providerId === "google"
      ? `${probe.url}?key=${encodeURIComponent(apiKey)}`
      : probe.url;

  try {
    const res = await fetch(url, {
      method: probe.method,
      headers: probe.buildHeaders(apiKey),
      body: probe.buildBody?.(),
      signal: AbortSignal.timeout(15000),
    });

    if (res.ok) {
      return { ok: true };
    }

    if (
      probe.treatClientErrorAsReachable &&
      !probe.authErrorStatuses?.includes(res.status) &&
      res.status < 500
    ) {
      return { ok: true };
    }

    const errBody = truncateProviderError(await res.text().catch(() => ""));
    return {
      ok: false,
      error: `Invalid API key — ${providerId} returned ${res.status}${errBody ? `: ${errBody}` : ""}`,
    };
  } catch (err) {
    return {
      ok: false,
      error: `Key validation failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

export async function fetchModelsFromProvider(
  provider: string,
  token: string,
): Promise<ProviderModelItem[]> {
  const providerId = String(provider || "").trim().toLowerCase();
  const apiKey = String(token || "").trim();
  const config = MODEL_LIST_CONFIG[providerId];

  if (!providerId || !apiKey) {
    throw new Error("Provider and token are required");
  }
  if (!config) {
    throw new Error(`Unknown provider: ${providerId}`);
  }

  const url = config.buildUrl ? config.buildUrl(apiKey) : config.url;
  const res = await fetch(url, {
    method: "GET",
    headers: config.buildHeaders(apiKey),
    signal: AbortSignal.timeout(15000),
  });

  if (!res.ok) {
    if (config.fallbackModels) {
      return config.fallbackModels;
    }
    throw new Error(`Provider returned ${res.status}`);
  }

  const data = await res.json();

  switch (providerId) {
    case "anthropic": {
      const rows =
        data && typeof data === "object" && Array.isArray((data as { data?: unknown[] }).data)
          ? (data as { data: Array<{ id?: string; display_name?: string; name?: string }> }).data
          : [];
      return rows
        .map((row) => {
          const rawId = String(row?.id || "").trim();
          if (!rawId) return null;
          return {
            id: rawId.startsWith("anthropic/") ? rawId : `anthropic/${rawId}`,
            name: String(row?.display_name || row?.name || rawId),
          };
        })
        .filter((row): row is ProviderModelItem => row !== null);
    }
    case "google": {
      const rows =
        data && typeof data === "object" && Array.isArray((data as { models?: unknown[] }).models)
          ? (data as { models: Array<{ name?: string; displayName?: string; supportedGenerationMethods?: string[] }> }).models
          : [];
      return rows
        .filter((row) => row.supportedGenerationMethods?.includes("generateContent"))
        .map((row) => {
          const modelName = String(row.name || "").replace(/^models\//, "");
          return {
            id: `google/${modelName}`,
            name: String(row.displayName || modelName),
          };
        })
        .filter((row) => row.id !== "google/");
    }
    case "minimax": {
      const parsed = parseStandardDataModels(providerId, data);
      return parsed.length > 0 ? parsed : config.fallbackModels || [];
    }
    default:
      return parseStandardDataModels(providerId, data);
  }
}

export function buildProviderCredentialPatch(
  provider: string,
  token: string,
): Record<string, unknown> {
  const providerId = String(provider || "").trim().toLowerCase();
  const envKey = PROVIDER_ENV_KEYS[providerId];
  if (!envKey) return {};

  const patch: Record<string, unknown> = {
    env: { [envKey]: token },
    auth: {
      profiles: {
        [`${providerId}:default`]: {
          provider: providerId,
          mode: "api_key",
        },
      },
    },
  };

  if (providerId === "minimax") {
    patch.models = {
      mode: "merge",
      providers: {
        minimax: MINIMAX_PROVIDER_CONFIG,
      },
    };
  }

  return patch;
}
