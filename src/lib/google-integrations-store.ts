import { randomUUID } from "crypto";
import { mkdir, readFile, rename, writeFile } from "fs/promises";
import { join } from "path";
import { getOpenClawHome } from "@/lib/paths";

export const GOOGLE_SERVICES = ["gmail", "calendar", "drive"] as const;
export type GoogleServiceKey = (typeof GOOGLE_SERVICES)[number];

export const GOOGLE_ACCESS_LEVELS = [
  "read-only",
  "read-draft",
  "read-write",
  "custom",
] as const;
export type GoogleAccessLevel = (typeof GOOGLE_ACCESS_LEVELS)[number];

export const GOOGLE_AGENT_POLICIES = ["deny", "ask", "allow"] as const;
export type GoogleAgentPolicy = (typeof GOOGLE_AGENT_POLICIES)[number];

export const GOOGLE_ACCOUNT_STATUSES = [
  "connected",
  "pending",
  "needs-reauthorization",
  "limited-access",
  "error",
] as const;
export type GoogleAccountStatus = (typeof GOOGLE_ACCOUNT_STATUSES)[number];

export const GOOGLE_APPROVAL_STATUSES = [
  "pending",
  "approved",
  "denied",
  "completed",
  "failed",
] as const;
export type GoogleApprovalStatus = (typeof GOOGLE_APPROVAL_STATUSES)[number];

export const GOOGLE_AUDIT_STATUSES = [
  "success",
  "error",
  "queued",
  "denied",
  "info",
] as const;
export type GoogleAuditStatus = (typeof GOOGLE_AUDIT_STATUSES)[number];

export const GOOGLE_CAPABILITIES = [
  "gmail.fetch-emails",
  "gmail.search-inbox",
  "gmail.read-message",
  "gmail.read-thread",
  "gmail.draft-reply",
  "gmail.reply-email",
  "gmail.send-email",
  "calendar.list-events",
  "calendar.read-event",
  "calendar.create-event",
  "calendar.update-event",
  "drive.list-files",
  "drive.search",
  "drive.download",
  "drive.upload",
] as const;
export type GoogleCapabilityKey = (typeof GOOGLE_CAPABILITIES)[number];

export type GoogleCapabilityDefinition = {
  key: GoogleCapabilityKey;
  service: GoogleServiceKey;
  label: string;
  description: string;
  category: "read" | "draft" | "write";
};

export const GOOGLE_CAPABILITY_DEFINITIONS: GoogleCapabilityDefinition[] = [
  {
    key: "gmail.fetch-emails",
    service: "gmail",
    label: "Fetch Emails",
    description: "Load recent inbox threads and message summaries.",
    category: "read",
  },
  {
    key: "gmail.search-inbox",
    service: "gmail",
    label: "Search Inbox",
    description: "Search Gmail using normal inbox filters and queries.",
    category: "read",
  },
  {
    key: "gmail.read-message",
    service: "gmail",
    label: "Read Message",
    description: "Open a specific Gmail message and inspect its content.",
    category: "read",
  },
  {
    key: "gmail.read-thread",
    service: "gmail",
    label: "Read Thread",
    description: "Read a full Gmail conversation thread end to end.",
    category: "read",
  },
  {
    key: "gmail.draft-reply",
    service: "gmail",
    label: "Draft Reply",
    description: "Create a draft reply without sending it.",
    category: "draft",
  },
  {
    key: "gmail.reply-email",
    service: "gmail",
    label: "Reply Email",
    description: "Reply inside an existing Gmail thread.",
    category: "write",
  },
  {
    key: "gmail.send-email",
    service: "gmail",
    label: "Send Email",
    description: "Send a new Gmail message from the connected account.",
    category: "write",
  },
  {
    key: "calendar.list-events",
    service: "calendar",
    label: "List Events",
    description: "List upcoming Google Calendar events.",
    category: "read",
  },
  {
    key: "calendar.read-event",
    service: "calendar",
    label: "Read Event",
    description: "Inspect a specific Google Calendar event.",
    category: "read",
  },
  {
    key: "calendar.create-event",
    service: "calendar",
    label: "Create Event",
    description: "Create a new Google Calendar event.",
    category: "write",
  },
  {
    key: "calendar.update-event",
    service: "calendar",
    label: "Update Event",
    description: "Change an existing Google Calendar event.",
    category: "write",
  },
  {
    key: "drive.list-files",
    service: "drive",
    label: "List Files",
    description: "List files and folders in Google Drive.",
    category: "read",
  },
  {
    key: "drive.search",
    service: "drive",
    label: "Search Drive",
    description: "Search for files across Google Drive.",
    category: "read",
  },
  {
    key: "drive.download",
    service: "drive",
    label: "Download File",
    description: "Download a file from Google Drive.",
    category: "read",
  },
  {
    key: "drive.upload",
    service: "drive",
    label: "Upload File",
    description: "Upload a file to Google Drive.",
    category: "write",
  },
];

export const GOOGLE_CAPABILITY_MAP = Object.fromEntries(
  GOOGLE_CAPABILITY_DEFINITIONS.map((entry) => [entry.key, entry]),
) as Record<GoogleCapabilityKey, GoogleCapabilityDefinition>;

export type GoogleServiceState = {
  enabled: boolean;
  apiStatus: "ready" | "unverified" | "error";
  scopeStatus: "full" | "readonly" | "unknown";
  lastCheckedAt: number | null;
  lastError: string | null;
};

export type GoogleWatchConfig = {
  enabled: boolean;
  status: "inactive" | "configured" | "watching" | "error";
  targetAgentId: string | null;
  label: string;
  projectId: string;
  topic: string;
  subscription: string;
  hookUrl: string;
  hookToken: string;
  pushEndpoint: string;
  pushToken: string;
  port: string;
  path: string;
  tailscaleMode: "funnel" | "serve" | "off";
  includeBody: boolean;
  maxBytes: number;
  lastConfiguredAt: number | null;
  lastCheckedAt: number | null;
  lastError: string | null;
};

export type GoogleAccountRecord = {
  id: string;
  email: string;
  label: string;
  authMode: "gog-remote";
  status: GoogleAccountStatus;
  accessLevel: GoogleAccessLevel;
  serviceStates: Record<GoogleServiceKey, GoogleServiceState>;
  customCapabilityAccess: Partial<Record<GoogleCapabilityKey, boolean>>;
  watch: GoogleWatchConfig;
  pendingAuthUrl: string | null;
  pendingAuthStartedAt: number | null;
  connectionNotes: string[];
  lastCheckedAt: number | null;
  lastError: string | null;
  createdAt: number;
  updatedAt: number;
};

export type GoogleAgentPolicyRecord = {
  id: string;
  accountId: string;
  agentId: string;
  capability: GoogleCapabilityKey;
  policy: GoogleAgentPolicy;
  updatedAt: number;
};

export type GoogleApprovalRequest = {
  id: string;
  accountId: string;
  agentId: string;
  capability: GoogleCapabilityKey;
  actionLabel: string;
  summary: string;
  payload: Record<string, unknown>;
  status: GoogleApprovalStatus;
  resultSummary: string | null;
  error: string | null;
  createdAt: number;
  resolvedAt: number | null;
  executedAt: number | null;
};

export type GoogleAuditEntry = {
  id: string;
  accountId: string | null;
  agentId: string | null;
  capability: GoogleCapabilityKey | "integration.info";
  action: string;
  summary: string;
  status: GoogleAuditStatus;
  detail: string | null;
  createdAt: number;
};

export type GoogleIntegrationsStore = {
  version: 1;
  updatedAt: number;
  accounts: GoogleAccountRecord[];
  policies: GoogleAgentPolicyRecord[];
  approvals: GoogleApprovalRequest[];
  audit: GoogleAuditEntry[];
};

export type GoogleAccountDraft = {
  email: string;
  label?: string;
  accessLevel: GoogleAccessLevel;
};

function integrationsStorePath(): string {
  return join(getOpenClawHome(), "ui", "google-integrations.json");
}

async function ensureStoreDir(): Promise<void> {
  await mkdir(join(getOpenClawHome(), "ui"), { recursive: true });
}

export function isGoogleCapabilityKey(value: string): value is GoogleCapabilityKey {
  return GOOGLE_CAPABILITIES.includes(value as GoogleCapabilityKey);
}

export function isGoogleAccessLevel(value: string): value is GoogleAccessLevel {
  return GOOGLE_ACCESS_LEVELS.includes(value as GoogleAccessLevel);
}

export function isGoogleAgentPolicy(value: string): value is GoogleAgentPolicy {
  return GOOGLE_AGENT_POLICIES.includes(value as GoogleAgentPolicy);
}

function createDefaultServiceState(service: GoogleServiceKey): GoogleServiceState {
  return {
    enabled: true,
    apiStatus: service === "gmail" ? "unverified" : "unverified",
    scopeStatus: "unknown",
    lastCheckedAt: null,
    lastError: null,
  };
}

function createDefaultWatchConfig(): GoogleWatchConfig {
  return {
    enabled: false,
    status: "inactive",
    targetAgentId: null,
    label: "INBOX",
    projectId: "",
    topic: "gog-gmail-watch",
    subscription: "gog-gmail-watch-push",
    hookUrl: "",
    hookToken: "",
    pushEndpoint: "",
    pushToken: "",
    port: "8788",
    path: "/gmail-pubsub",
    tailscaleMode: "funnel",
    includeBody: true,
    maxBytes: 20000,
    lastConfiguredAt: null,
    lastCheckedAt: null,
    lastError: null,
  };
}

export function createDefaultGoogleAccount(
  draft: GoogleAccountDraft,
): GoogleAccountRecord {
  const now = Date.now();
  return {
    id: randomUUID(),
    email: draft.email.trim().toLowerCase(),
    label: draft.label?.trim() || draft.email.trim(),
    authMode: "gog-remote",
    status: "pending",
    accessLevel: draft.accessLevel,
    serviceStates: {
      gmail: createDefaultServiceState("gmail"),
      calendar: createDefaultServiceState("calendar"),
      drive: createDefaultServiceState("drive"),
    },
    customCapabilityAccess: {},
    watch: createDefaultWatchConfig(),
    pendingAuthUrl: null,
    pendingAuthStartedAt: null,
    connectionNotes: [],
    lastCheckedAt: null,
    lastError: null,
    createdAt: now,
    updatedAt: now,
  };
}

export function createDefaultGoogleIntegrationsStore(): GoogleIntegrationsStore {
  return {
    version: 1,
    updatedAt: Date.now(),
    accounts: [],
    policies: [],
    approvals: [],
    audit: [],
  };
}

function sanitizeServiceStates(
  value: unknown,
): Record<GoogleServiceKey, GoogleServiceState> {
  const source = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const next: Record<GoogleServiceKey, GoogleServiceState> = {
    gmail: createDefaultServiceState("gmail"),
    calendar: createDefaultServiceState("calendar"),
    drive: createDefaultServiceState("drive"),
  };
  for (const service of GOOGLE_SERVICES) {
    const row = source[service];
    if (!row || typeof row !== "object") continue;
    const entry = row as Partial<GoogleServiceState>;
    next[service] = {
      enabled: entry.enabled !== false,
      apiStatus:
        entry.apiStatus === "ready" || entry.apiStatus === "error"
          ? entry.apiStatus
          : "unverified",
      scopeStatus:
        entry.scopeStatus === "full" || entry.scopeStatus === "readonly"
          ? entry.scopeStatus
          : "unknown",
      lastCheckedAt:
        typeof entry.lastCheckedAt === "number" ? entry.lastCheckedAt : null,
      lastError: typeof entry.lastError === "string" ? entry.lastError : null,
    };
  }
  return next;
}

function sanitizeWatchConfig(value: unknown): GoogleWatchConfig {
  const source = value && typeof value === "object" ? (value as Partial<GoogleWatchConfig>) : {};
  const base = createDefaultWatchConfig();
  return {
    ...base,
    enabled: source.enabled === true,
    status:
      source.status === "configured" ||
      source.status === "watching" ||
      source.status === "error"
        ? source.status
        : "inactive",
    targetAgentId:
      typeof source.targetAgentId === "string" ? source.targetAgentId : null,
    label: typeof source.label === "string" && source.label.trim() ? source.label : base.label,
    projectId: typeof source.projectId === "string" ? source.projectId : "",
    topic: typeof source.topic === "string" && source.topic.trim() ? source.topic : base.topic,
    subscription:
      typeof source.subscription === "string" && source.subscription.trim()
        ? source.subscription
        : base.subscription,
    hookUrl: typeof source.hookUrl === "string" ? source.hookUrl : "",
    hookToken: typeof source.hookToken === "string" ? source.hookToken : "",
    pushEndpoint: typeof source.pushEndpoint === "string" ? source.pushEndpoint : "",
    pushToken: typeof source.pushToken === "string" ? source.pushToken : "",
    port: typeof source.port === "string" && source.port.trim() ? source.port : base.port,
    path: typeof source.path === "string" && source.path.trim() ? source.path : base.path,
    tailscaleMode:
      source.tailscaleMode === "serve" || source.tailscaleMode === "off"
        ? source.tailscaleMode
        : "funnel",
    includeBody: source.includeBody !== false,
    maxBytes:
      typeof source.maxBytes === "number" && Number.isFinite(source.maxBytes)
        ? source.maxBytes
        : base.maxBytes,
    lastConfiguredAt:
      typeof source.lastConfiguredAt === "number" ? source.lastConfiguredAt : null,
    lastCheckedAt:
      typeof source.lastCheckedAt === "number" ? source.lastCheckedAt : null,
    lastError: typeof source.lastError === "string" ? source.lastError : null,
  };
}

function sanitizeCustomCapabilityAccess(
  value: unknown,
): Partial<Record<GoogleCapabilityKey, boolean>> {
  if (!value || typeof value !== "object") return {};
  const out: Partial<Record<GoogleCapabilityKey, boolean>> = {};
  for (const [key, enabled] of Object.entries(value as Record<string, unknown>)) {
    if (!isGoogleCapabilityKey(key)) continue;
    out[key] = enabled === true;
  }
  return out;
}

function sanitizeAccount(value: unknown): GoogleAccountRecord | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Partial<GoogleAccountRecord>;
  const email = String(record.email || "").trim().toLowerCase();
  if (!email) return null;
  const now = Date.now();
  return {
    id: typeof record.id === "string" && record.id ? record.id : randomUUID(),
    email,
    label: typeof record.label === "string" && record.label.trim() ? record.label.trim() : email,
    authMode: "gog-remote",
    status:
      record.status && GOOGLE_ACCOUNT_STATUSES.includes(record.status)
        ? record.status
        : "pending",
    accessLevel: isGoogleAccessLevel(String(record.accessLevel || ""))
      ? (record.accessLevel as GoogleAccessLevel)
      : "read-only",
    serviceStates: sanitizeServiceStates(record.serviceStates),
    customCapabilityAccess: sanitizeCustomCapabilityAccess(record.customCapabilityAccess),
    watch: sanitizeWatchConfig(record.watch),
    pendingAuthUrl:
      typeof record.pendingAuthUrl === "string" ? record.pendingAuthUrl : null,
    pendingAuthStartedAt:
      typeof record.pendingAuthStartedAt === "number"
        ? record.pendingAuthStartedAt
        : null,
    connectionNotes: Array.isArray(record.connectionNotes)
      ? record.connectionNotes.filter((entry): entry is string => typeof entry === "string")
      : [],
    lastCheckedAt:
      typeof record.lastCheckedAt === "number" ? record.lastCheckedAt : null,
    lastError: typeof record.lastError === "string" ? record.lastError : null,
    createdAt: typeof record.createdAt === "number" ? record.createdAt : now,
    updatedAt: typeof record.updatedAt === "number" ? record.updatedAt : now,
  };
}

function sanitizePolicy(value: unknown): GoogleAgentPolicyRecord | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Partial<GoogleAgentPolicyRecord>;
  if (
    typeof record.accountId !== "string" ||
    typeof record.agentId !== "string" ||
    !isGoogleCapabilityKey(String(record.capability || "")) ||
    !isGoogleAgentPolicy(String(record.policy || ""))
  ) {
    return null;
  }
  return {
    id: typeof record.id === "string" && record.id ? record.id : randomUUID(),
    accountId: record.accountId,
    agentId: record.agentId,
    capability: record.capability as GoogleCapabilityKey,
    policy: record.policy as GoogleAgentPolicy,
    updatedAt: typeof record.updatedAt === "number" ? record.updatedAt : Date.now(),
  };
}

function sanitizeApproval(value: unknown): GoogleApprovalRequest | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Partial<GoogleApprovalRequest>;
  if (
    typeof record.accountId !== "string" ||
    typeof record.agentId !== "string" ||
    !isGoogleCapabilityKey(String(record.capability || "")) ||
    typeof record.actionLabel !== "string" ||
    typeof record.summary !== "string"
  ) {
    return null;
  }
  return {
    id: typeof record.id === "string" && record.id ? record.id : randomUUID(),
    accountId: record.accountId,
    agentId: record.agentId,
    capability: record.capability as GoogleCapabilityKey,
    actionLabel: record.actionLabel,
    summary: record.summary,
    payload:
      record.payload && typeof record.payload === "object"
        ? { ...(record.payload as Record<string, unknown>) }
        : {},
    status:
      record.status && GOOGLE_APPROVAL_STATUSES.includes(record.status)
        ? record.status
        : "pending",
    resultSummary:
      typeof record.resultSummary === "string" ? record.resultSummary : null,
    error: typeof record.error === "string" ? record.error : null,
    createdAt: typeof record.createdAt === "number" ? record.createdAt : Date.now(),
    resolvedAt: typeof record.resolvedAt === "number" ? record.resolvedAt : null,
    executedAt: typeof record.executedAt === "number" ? record.executedAt : null,
  };
}

function sanitizeAudit(value: unknown): GoogleAuditEntry | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Partial<GoogleAuditEntry>;
  const capability = String(record.capability || "");
  if (
    (capability !== "integration.info" && !isGoogleCapabilityKey(capability)) ||
    typeof record.action !== "string" ||
    typeof record.summary !== "string"
  ) {
    return null;
  }
  return {
    id: typeof record.id === "string" && record.id ? record.id : randomUUID(),
    accountId: typeof record.accountId === "string" ? record.accountId : null,
    agentId: typeof record.agentId === "string" ? record.agentId : null,
    capability:
      capability === "integration.info"
        ? "integration.info"
        : (capability as GoogleCapabilityKey),
    action: record.action,
    summary: record.summary,
    status:
      record.status && GOOGLE_AUDIT_STATUSES.includes(record.status)
        ? record.status
        : "info",
    detail: typeof record.detail === "string" ? record.detail : null,
    createdAt: typeof record.createdAt === "number" ? record.createdAt : Date.now(),
  };
}

function normalizeStore(
  value: Partial<GoogleIntegrationsStore> | null | undefined,
): GoogleIntegrationsStore {
  const fallback = createDefaultGoogleIntegrationsStore();
  return {
    version: 1,
    updatedAt:
      typeof value?.updatedAt === "number" ? value.updatedAt : fallback.updatedAt,
    accounts: Array.isArray(value?.accounts)
      ? value.accounts.map(sanitizeAccount).filter((entry): entry is GoogleAccountRecord => Boolean(entry))
      : [],
    policies: Array.isArray(value?.policies)
      ? value.policies.map(sanitizePolicy).filter((entry): entry is GoogleAgentPolicyRecord => Boolean(entry))
      : [],
    approvals: Array.isArray(value?.approvals)
      ? value.approvals
          .map(sanitizeApproval)
          .filter((entry): entry is GoogleApprovalRequest => Boolean(entry))
      : [],
    audit: Array.isArray(value?.audit)
      ? value.audit.map(sanitizeAudit).filter((entry): entry is GoogleAuditEntry => Boolean(entry))
      : [],
  };
}

export async function readGoogleIntegrationsStore(): Promise<GoogleIntegrationsStore> {
  await ensureStoreDir();
  try {
    const raw = await readFile(integrationsStorePath(), "utf-8");
    return normalizeStore(JSON.parse(raw) as Partial<GoogleIntegrationsStore>);
  } catch {
    const store = createDefaultGoogleIntegrationsStore();
    await saveGoogleIntegrationsStore(store);
    return store;
  }
}

export async function saveGoogleIntegrationsStore(
  store: GoogleIntegrationsStore,
): Promise<void> {
  await ensureStoreDir();
  const path = integrationsStorePath();
  const tempPath = `${path}.tmp`;
  const next = normalizeStore(store);
  next.updatedAt = Date.now();
  await writeFile(tempPath, JSON.stringify(next, null, 2), "utf-8");
  await rename(tempPath, path);
}

export function upsertGoogleAccount(
  store: GoogleIntegrationsStore,
  nextAccount: GoogleAccountRecord,
): GoogleIntegrationsStore {
  const accounts = [...store.accounts];
  const index = accounts.findIndex(
    (entry) => entry.id === nextAccount.id || entry.email === nextAccount.email,
  );
  const account = {
    ...nextAccount,
    updatedAt: Date.now(),
  };
  if (index >= 0) accounts[index] = account;
  else accounts.unshift(account);
  return { ...store, accounts, updatedAt: Date.now() };
}

export function removeGoogleAccount(
  store: GoogleIntegrationsStore,
  accountId: string,
): GoogleIntegrationsStore {
  return {
    ...store,
    accounts: store.accounts.filter((entry) => entry.id !== accountId),
    policies: store.policies.filter((entry) => entry.accountId !== accountId),
    approvals: store.approvals.filter((entry) => entry.accountId !== accountId),
    updatedAt: Date.now(),
  };
}

export function setGoogleAgentPolicyRecord(
  store: GoogleIntegrationsStore,
  params: {
    accountId: string;
    agentId: string;
    capability: GoogleCapabilityKey;
    policy: GoogleAgentPolicy;
  },
): GoogleIntegrationsStore {
  const policies = [...store.policies];
  const index = policies.findIndex(
    (entry) =>
      entry.accountId === params.accountId &&
      entry.agentId === params.agentId &&
      entry.capability === params.capability,
  );
  const next: GoogleAgentPolicyRecord = {
    id: index >= 0 ? policies[index].id : randomUUID(),
    accountId: params.accountId,
    agentId: params.agentId,
    capability: params.capability,
    policy: params.policy,
    updatedAt: Date.now(),
  };
  if (index >= 0) policies[index] = next;
  else policies.push(next);
  return { ...store, policies, updatedAt: Date.now() };
}

export function getGoogleAgentPolicy(
  store: GoogleIntegrationsStore,
  accountId: string,
  agentId: string,
  capability: GoogleCapabilityKey,
): GoogleAgentPolicy {
  const row = store.policies.find(
    (entry) =>
      entry.accountId === accountId &&
      entry.agentId === agentId &&
      entry.capability === capability,
  );
  if (row) return row.policy;
  const capabilityMeta = GOOGLE_CAPABILITY_MAP[capability];
  return capabilityMeta.category === "write" ? "ask" : "allow";
}

export function isCapabilityEnabledForAccount(
  account: GoogleAccountRecord,
  capability: GoogleCapabilityKey,
): boolean {
  const meta = GOOGLE_CAPABILITY_MAP[capability];
  if (!meta) return false;
  if (!account.serviceStates[meta.service]?.enabled) return false;

  if (account.accessLevel === "custom") {
    return account.customCapabilityAccess[capability] !== false;
  }

  if (account.accessLevel === "read-only") {
    return meta.category === "read";
  }

  if (account.accessLevel === "read-draft") {
    return meta.category === "read" || meta.category === "draft";
  }

  return true;
}

export function appendGoogleAuditEntry(
  store: GoogleIntegrationsStore,
  entry: Omit<GoogleAuditEntry, "id" | "createdAt">,
): GoogleIntegrationsStore {
  const audit = [
    {
      ...entry,
      id: randomUUID(),
      createdAt: Date.now(),
    },
    ...store.audit,
  ].slice(0, 200);
  return { ...store, audit, updatedAt: Date.now() };
}

export function appendGoogleApproval(
  store: GoogleIntegrationsStore,
  entry: Omit<GoogleApprovalRequest, "id" | "createdAt" | "status" | "resolvedAt" | "executedAt">,
): { store: GoogleIntegrationsStore; approval: GoogleApprovalRequest } {
  const approval: GoogleApprovalRequest = {
    ...entry,
    id: randomUUID(),
    status: "pending",
    createdAt: Date.now(),
    resolvedAt: null,
    executedAt: null,
  };
  return {
    store: {
      ...store,
      approvals: [approval, ...store.approvals].slice(0, 100),
      updatedAt: Date.now(),
    },
    approval,
  };
}

export function updateGoogleApproval(
  store: GoogleIntegrationsStore,
  approvalId: string,
  patch: Partial<GoogleApprovalRequest>,
): GoogleIntegrationsStore {
  const approvals = store.approvals.map((entry) =>
    entry.id === approvalId
      ? {
          ...entry,
          ...patch,
        }
      : entry,
  );
  return { ...store, approvals, updatedAt: Date.now() };
}

export function getAccountCapabilityMatrix(
  account: GoogleAccountRecord,
  store: GoogleIntegrationsStore,
  agentId: string,
): Array<GoogleCapabilityDefinition & { enabled: boolean; policy: GoogleAgentPolicy }> {
  return GOOGLE_CAPABILITY_DEFINITIONS.map((capability) => ({
    ...capability,
    enabled: isCapabilityEnabledForAccount(account, capability.key),
    policy: getGoogleAgentPolicy(store, account.id, agentId, capability.key),
  }));
}
