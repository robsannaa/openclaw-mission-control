import { fetchCalendarEventsViaGog } from "@/lib/gog-calendar";
import { runGogCaptureBoth } from "@/lib/gog-cli";
import type { GoogleServiceKey } from "@/lib/google-integrations-store";
import { getGogBin, getGogKeyringEnv } from "@/lib/paths";
import { execFile, spawn, type ChildProcess } from "child_process";
import { promisify } from "util";

export type GogAvailability = {
  available: boolean;
  bin: string | null;
};

export type GogAuthStatus = {
  credentialsExists: boolean;
  credentialsPath: string | null;
  keyringBackend: string | null;
  keyringSource: string | null;
  serviceAccountConfigured: boolean;
};

export type GogStoredAccount = {
  email: string;
  source: "gog" | "keychain-fallback";
  raw: Record<string, unknown>;
};

export type GogRemoteAuthStart = {
  authUrl: string;
  stateReused: boolean;
};

export type GogMailboxThread = {
  id: string;
  messageId: string | null;
  subject: string;
  snippet: string;
  from: string;
  to: string[];
  lastMessageAt: string | null;
  threadUrl: string | null;
};

export type GogThreadMessage = {
  id: string;
  threadId: string;
  subject: string;
  from: string;
  to: string[];
  cc: string[];
  date: string | null;
  snippet: string;
  bodyText: string;
};

export type GogThreadDetails = {
  id: string;
  subject: string;
  snippet: string;
  messages: GogThreadMessage[];
};

export type GogSendEmailInput = {
  account: string;
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  body: string;
  bodyHtml?: string;
  threadId?: string;
  replyToMessageId?: string;
  replyAll?: boolean;
  quote?: boolean;
  draftOnly?: boolean;
};

export type GogCalendarEventDraft = {
  account: string;
  calendarId: string;
  summary: string;
  from: string;
  to: string;
  description?: string;
  location?: string;
  attendees?: string[];
  allDay?: boolean;
};

type JsonRecord = Record<string, unknown>;

const exec = promisify(execFile);

async function runGogCommand(
  args: string[],
  timeout = 20000,
): Promise<{ stdout: string; stderr: string; code: number | null }> {
  return runGogCaptureBoth(args, timeout, {
    envOverrides: getGogKeyringEnv(),
  });
}

function parseJsonLoose<T>(stdout: string): T {
  const trimmed = stdout.trim();
  if (!trimmed) {
    throw new Error("gog returned empty output");
  }
  return JSON.parse(trimmed) as T;
}

function joinQueryParts(query: string): string[] {
  return query
    .split(/\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function normalizeList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry || "").trim()).filter(Boolean);
  }
  if (typeof value === "string" && value.trim()) {
    return value
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);
  }
  return [];
}

function pickString(obj: JsonRecord, keys: string[]): string | null {
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function pickNestedString(obj: JsonRecord, path: string[]): string | null {
  let cursor: unknown = obj;
  for (const part of path) {
    if (!cursor || typeof cursor !== "object") return null;
    cursor = (cursor as JsonRecord)[part];
  }
  return typeof cursor === "string" && cursor.trim() ? cursor.trim() : null;
}

function parseStoredAccounts(value: unknown): GogStoredAccount[] {
  const rows = Array.isArray(value)
    ? value
    : value && typeof value === "object"
      ? (Array.isArray((value as JsonRecord).accounts)
          ? ((value as JsonRecord).accounts as unknown[])
          : [])
      : [];
  const results: GogStoredAccount[] = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const raw = row as JsonRecord;
    const email =
      pickString(raw, ["email", "account", "id"]) ||
      pickNestedString(raw, ["account", "email"]);
    if (!email) continue;
    results.push({ email, source: "gog", raw });
  }
  return results;
}

async function listMacOsKeychainGogAccounts(): Promise<GogStoredAccount[]> {
  if (process.platform !== "darwin") return [];
  try {
    const { stdout } = await exec("security", ["dump-keychain", "login.keychain-db"], {
      encoding: "utf-8",
      timeout: 10000,
      maxBuffer: 2 * 1024 * 1024,
    });
    const matches = stdout.match(/"acct"<blob>="token:(?:default:)?([^"\n]+)"/g) || [];
    const emails = new Set<string>();
    for (const line of matches) {
      const match = line.match(/"acct"<blob>="token:(?:default:)?([^"\n]+)"/);
      const email = match?.[1]?.trim().toLowerCase();
      if (email) emails.add(email);
    }
    return [...emails].sort().map((email) => ({
      email,
      source: "keychain-fallback" as const,
      raw: { source: "macos-keychain-fallback" },
    }));
  } catch {
    return [];
  }
}

function parseSearchRows(value: unknown): GogMailboxThread[] {
  const rows = Array.isArray(value)
    ? value
    : value && typeof value === "object"
      ? [
          ...(((value as JsonRecord).threads as unknown[]) || []),
          ...(((value as JsonRecord).items as unknown[]) || []),
          ...(((value as JsonRecord).results as unknown[]) || []),
        ]
      : [];

  return rows
    .map((row) => {
      if (!row || typeof row !== "object") return null;
      const raw = row as JsonRecord;
      const id = pickString(raw, ["threadId", "id"]);
      if (!id) return null;
      return {
        id,
        messageId: pickString(raw, ["messageId", "latestMessageId"]),
        subject: pickString(raw, ["subject", "title"]) || "(No subject)",
        snippet: pickString(raw, ["snippet", "preview"]) || "",
        from: pickString(raw, ["from", "sender"]) || "",
        to: normalizeList(raw.to),
        lastMessageAt:
          pickString(raw, ["lastMessageAt", "date", "internalDate"]) ||
          pickNestedString(raw, ["latestMessage", "date"]),
        threadUrl: pickString(raw, ["threadUrl", "url"]),
      };
    })
    .filter((entry): entry is GogMailboxThread => Boolean(entry));
}

function parseMessageBody(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "";
  const raw = payload as JsonRecord;
  const direct = pickString(raw, ["bodyText", "text", "snippet"]);
  if (direct) return direct;
  const body = raw.body;
  if (body && typeof body === "object") {
    const bodyText = pickString(body as JsonRecord, ["data", "text"]);
    if (bodyText) return bodyText;
  }
  const parts = Array.isArray(raw.parts) ? raw.parts : [];
  for (const part of parts) {
    if (!part || typeof part !== "object") continue;
    const text = parseMessageBody(part);
    if (text) return text;
  }
  return "";
}

function parseHeaders(raw: JsonRecord): Record<string, string> {
  const payload = raw.payload;
  const headers = payload && typeof payload === "object" ? (payload as JsonRecord).headers : [];
  const out: Record<string, string> = {};
  if (!Array.isArray(headers)) return out;
  for (const header of headers) {
    if (!header || typeof header !== "object") continue;
    const row = header as JsonRecord;
    const name = typeof row.name === "string" ? row.name.toLowerCase() : "";
    const value = typeof row.value === "string" ? row.value : "";
    if (name && value) out[name] = value;
  }
  return out;
}

function parseThread(value: unknown): GogThreadDetails {
  const raw = value && typeof value === "object" ? (value as JsonRecord) : {};
  const threadId = pickString(raw, ["threadId", "id"]) || "thread";
  const messages = Array.isArray(raw.messages) ? raw.messages : [];
  const parsedMessages = messages
    .map((row) => {
      if (!row || typeof row !== "object") return null;
      const message = row as JsonRecord;
      const headers = parseHeaders(message);
      const id = pickString(message, ["id", "messageId"]);
      if (!id) return null;
      return {
        id,
        threadId,
        subject:
          headers.subject ||
          pickString(message, ["subject"]) ||
          pickString(raw, ["subject"]) ||
          "(No subject)",
        from: headers.from || pickString(message, ["from"]) || "",
        to: normalizeList(headers.to || message.to),
        cc: normalizeList(headers.cc || message.cc),
        date:
          headers.date ||
          pickString(message, ["internalDate", "date"]) ||
          null,
        snippet:
          pickString(message, ["snippet", "preview"]) ||
          pickString(raw, ["snippet"]) ||
          "",
        bodyText: parseMessageBody(message.payload),
      };
    })
    .filter((entry): entry is GogThreadMessage => Boolean(entry));

  return {
    id: threadId,
    subject:
      parsedMessages[0]?.subject ||
      pickString(raw, ["subject"]) ||
      "(No subject)",
    snippet: pickString(raw, ["snippet", "preview"]) || parsedMessages[0]?.snippet || "",
    messages: parsedMessages,
  };
}

export async function getGogAvailability(): Promise<GogAvailability> {
  try {
    const bin = await getGogBin();
    return { available: true, bin };
  } catch {
    return { available: false, bin: null };
  }
}

export async function getGogAuthStatus(): Promise<GogAuthStatus> {
  const { stdout, stderr, code } = await runGogCommand(["auth", "status", "--json", "--no-input"]);
  if (code !== 0) {
    throw new Error(stderr.trim() || stdout.trim() || "Unable to read gog auth status");
  }
  const parsed = parseJsonLoose<JsonRecord>(stdout);
  const account = (parsed.account || {}) as JsonRecord;
  const keyring = (parsed.keyring || {}) as JsonRecord;
  return {
    credentialsExists: Boolean(account.credentials_exists),
    credentialsPath:
      (typeof account.credentials_path === "string" && account.credentials_path) || null,
    keyringBackend:
      (typeof keyring.backend === "string" && keyring.backend) || null,
    keyringSource:
      (typeof keyring.source === "string" && keyring.source) || null,
    serviceAccountConfigured: Boolean(account.service_account_configured),
  };
}

export async function listGogStoredAccounts(): Promise<GogStoredAccount[]> {
  const { stdout, stderr, code } = await runGogCommand(["auth", "list", "--json", "--no-input"]);
  if (code !== 0) {
    const message = stderr.trim() || stdout.trim();
    if (
      message.includes("refresh token missing") ||
      message.includes("Secret not found in keyring")
    ) {
      return listMacOsKeychainGogAccounts();
    }
    throw new Error(message || "Unable to list gog accounts");
  }
  const parsed = parseStoredAccounts(parseJsonLoose<unknown>(stdout));
  if (parsed.length > 0) return parsed;
  return listMacOsKeychainGogAccounts();
}

// ---------------------------------------------------------------------------
// Live auth session — gog starts a local HTTP callback server, user signs in,
// Google redirects back to gog's server, gog exchanges the code automatically.
// ---------------------------------------------------------------------------

type GogAuthSession = {
  email: string;
  authUrl: string;
  status: "waiting" | "completed" | "failed" | "timeout";
  error: string | null;
  startedAt: number;
  process: ChildProcess;
};

const authSessions = new Map<string, GogAuthSession>();

/** Kill any stale sessions older than 6 minutes */
function reapStaleSessions() {
  const maxAge = 6 * 60 * 1000;
  for (const [key, session] of authSessions) {
    if (Date.now() - session.startedAt > maxAge) {
      try { session.process.kill(); } catch { /* already dead */ }
      authSessions.delete(key);
    }
  }
}

function extractAuthUrl(text: string): string | null {
  const match = text.match(/(https:\/\/accounts\.google\.com\/o\/oauth2\/auth[^\s]+)/);
  return match?.[1] || null;
}

export async function startGogLiveAuth(params: {
  email: string;
  services: GoogleServiceKey[];
  readonly: boolean;
}): Promise<GogRemoteAuthStart> {
  reapStaleSessions();

  // Kill any existing session for this email
  const existing = authSessions.get(params.email);
  if (existing) {
    try { existing.process.kill(); } catch { /* already dead */ }
    authSessions.delete(params.email);
  }

  const bin = await getGogBin();
  const args = [
    "auth",
    "add",
    params.email,
    "--services",
    params.services.join(","),
    "--force-consent",
    "--json",
  ];
  if (params.readonly) args.push("--readonly");

  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, {
      env: {
        ...process.env,
        ...getGogKeyringEnv(),
        BROWSER: "echo", // prevent gog from opening system browser
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let resolved = false;

    const session: GogAuthSession = {
      email: params.email,
      authUrl: "",
      status: "waiting",
      error: null,
      startedAt: Date.now(),
      process: child,
    };
    authSessions.set(params.email, session);

    // Parse auth URL from output as soon as it appears
    const onData = (chunk: Buffer) => {
      const text = chunk.toString();
      stdout += text;
      stderr += text;
      if (!resolved) {
        const url = extractAuthUrl(stdout + stderr);
        if (url) {
          resolved = true;
          session.authUrl = url;
          resolve({ authUrl: url, stateReused: false });
        }
      }
    };
    child.stdout?.on("data", onData);
    child.stderr?.on("data", onData);

    child.on("close", (code) => {
      if (code === 0) {
        session.status = "completed";
      } else {
        session.status = "failed";
        session.error = stderr.trim() || stdout.trim() || "Auth process failed";
      }
      if (!resolved) {
        resolved = true;
        reject(new Error(session.error || "gog exited without providing an auth URL"));
      }
    });

    // Timeout after 5 minutes
    setTimeout(() => {
      if (session.status === "waiting") {
        session.status = "timeout";
        session.error = "Auth timed out after 5 minutes";
        try { child.kill(); } catch { /* already dead */ }
      }
      if (!resolved) {
        resolved = true;
        reject(new Error("Timed out waiting for auth URL from gog"));
      }
    }, 5 * 60 * 1000);

    // Reject if we don't get the URL within 15 seconds
    setTimeout(() => {
      if (!resolved) {
        resolved = true;
        reject(new Error(stderr.trim() || stdout.trim() || "gog did not return an auth URL in time"));
      }
    }, 15000);
  });
}

export function getGogAuthSessionStatus(email: string): {
  status: "waiting" | "completed" | "failed" | "timeout" | "none";
  error: string | null;
} {
  const session = authSessions.get(email);
  if (!session) return { status: "none", error: null };
  return { status: session.status, error: session.error };
}

export function cleanupGogAuthSession(email: string) {
  const session = authSessions.get(email);
  if (session) {
    try { session.process.kill(); } catch { /* already dead */ }
    authSessions.delete(email);
  }
}

// Legacy remote auth (kept as fallback for environments where live auth can't work)
export async function startGogRemoteAuth(params: {
  email: string;
  services: GoogleServiceKey[];
  readonly: boolean;
}): Promise<GogRemoteAuthStart> {
  const args = [
    "auth",
    "add",
    params.email,
    "--services",
    params.services.join(","),
    "--remote",
    "--step",
    "1",
    "--json",
    "--no-input",
  ];
  if (params.readonly) args.push("--readonly");
  const { stdout, stderr, code } = await runGogCommand(args);
  if (code !== 0) {
    throw new Error(stderr.trim() || stdout.trim() || "Unable to start Google sign-in");
  }
  const parsed = parseJsonLoose<JsonRecord>(stdout);
  const authUrl = pickString(parsed, ["auth_url", "authUrl"]);
  if (!authUrl) throw new Error("gog did not return an authentication URL");
  return {
    authUrl,
    stateReused: parsed.state_reused === true,
  };
}

export async function finishGogRemoteAuth(params: {
  email: string;
  services: GoogleServiceKey[];
  readonly: boolean;
  authUrl: string;
}): Promise<void> {
  const args = [
    "auth",
    "add",
    params.email,
    "--services",
    params.services.join(","),
    "--remote",
    "--step",
    "2",
    "--auth-url",
    params.authUrl,
    "--json",
    "--no-input",
  ];
  if (params.readonly) args.push("--readonly");
  const { stdout, stderr, code } = await runGogCommand(args, 30000);
  if (code !== 0) {
    throw new Error(stderr.trim() || stdout.trim() || "Unable to finish Google sign-in");
  }
}

export async function searchGmailInbox(params: {
  account: string;
  query: string;
  max?: number;
}): Promise<GogMailboxThread[]> {
  const queryParts = joinQueryParts(params.query || "in:inbox");
  const args = [
    "gmail",
    "search",
    ...queryParts,
    "--account",
    params.account,
    "--json",
    "--no-input",
    "--max",
    String(params.max || 20),
  ];
  const { stdout, stderr, code } = await runGogCommand(args, 30000);
  if (code !== 0) {
    throw new Error(stderr.trim() || stdout.trim() || "Unable to search Gmail");
  }
  return parseSearchRows(parseJsonLoose<unknown>(stdout));
}

export async function getGmailThread(params: {
  account: string;
  threadId: string;
}): Promise<GogThreadDetails> {
  const args = [
    "gmail",
    "thread",
    "get",
    params.threadId,
    "--account",
    params.account,
    "--json",
    "--no-input",
    "--full",
  ];
  const { stdout, stderr, code } = await runGogCommand(args, 30000);
  if (code !== 0) {
    throw new Error(stderr.trim() || stdout.trim() || "Unable to read Gmail thread");
  }
  return parseThread(parseJsonLoose<unknown>(stdout));
}

export async function sendOrDraftGmail(
  params: GogSendEmailInput,
): Promise<JsonRecord> {
  const args = [
    "gmail",
    params.draftOnly ? "drafts" : "send",
    ...(params.draftOnly ? ["create"] : []),
    "--account",
    params.account,
    "--json",
    "--no-input",
    "--subject",
    params.subject,
    "--body",
    params.body,
  ];
  if (params.to.length > 0) args.push("--to", params.to.join(","));
  if (params.cc && params.cc.length > 0) args.push("--cc", params.cc.join(","));
  if (params.bcc && params.bcc.length > 0) args.push("--bcc", params.bcc.join(","));
  if (params.bodyHtml) args.push("--body-html", params.bodyHtml);
  if (params.replyToMessageId) args.push("--reply-to-message-id", params.replyToMessageId);
  if (params.threadId) args.push("--thread-id", params.threadId);
  if (params.replyAll) args.push("--reply-all");
  if (params.quote) args.push("--quote");
  const { stdout, stderr, code } = await runGogCommand(args, 30000);
  if (code !== 0) {
    throw new Error(stderr.trim() || stdout.trim() || "Unable to send Gmail message");
  }
  return parseJsonLoose<JsonRecord>(stdout);
}

export async function listCalendarEventsForAccount(params: {
  account: string;
  days: number;
}) {
  const result = await fetchCalendarEventsViaGog(params.days, params.account);
  return result.events;
}

export async function createCalendarEventForAccount(
  params: GogCalendarEventDraft,
): Promise<JsonRecord> {
  const args = [
    "calendar",
    "create",
    params.calendarId,
    "--account",
    params.account,
    "--json",
    "--no-input",
    "--summary",
    params.summary,
    "--from",
    params.from,
    "--to",
    params.to,
  ];
  if (params.description) args.push("--description", params.description);
  if (params.location) args.push("--location", params.location);
  if (params.attendees && params.attendees.length > 0) {
    args.push("--attendees", params.attendees.join(","));
  }
  if (params.allDay) args.push("--all-day");
  const { stdout, stderr, code } = await runGogCommand(args, 30000);
  if (code !== 0) {
    throw new Error(stderr.trim() || stdout.trim() || "Unable to create calendar event");
  }
  return parseJsonLoose<JsonRecord>(stdout);
}

export async function updateCalendarEventForAccount(
  params: GogCalendarEventDraft & { eventId: string },
): Promise<JsonRecord> {
  const args = [
    "calendar",
    "update",
    params.calendarId,
    params.eventId,
    "--account",
    params.account,
    "--json",
    "--no-input",
  ];
  if (params.summary) args.push("--summary", params.summary);
  if (params.from) args.push("--from", params.from);
  if (params.to) args.push("--to", params.to);
  if (params.description !== undefined) args.push("--description", params.description);
  if (params.location !== undefined) args.push("--location", params.location);
  if (params.attendees) args.push("--attendees", params.attendees.join(","));
  if (params.allDay) args.push("--all-day");
  const { stdout, stderr, code } = await runGogCommand(args, 30000);
  if (code !== 0) {
    throw new Error(stderr.trim() || stdout.trim() || "Unable to update calendar event");
  }
  return parseJsonLoose<JsonRecord>(stdout);
}

export type GogDriveFile = {
  id: string;
  name: string;
  mimeType: string;
  size: string | null;
  modifiedTime: string | null;
  webViewLink: string | null;
};

function parseDriveFiles(value: unknown): GogDriveFile[] {
  const rows = Array.isArray(value)
    ? value
    : value && typeof value === "object"
      ? [
          ...(((value as JsonRecord).files as unknown[]) || []),
          ...(((value as JsonRecord).items as unknown[]) || []),
          ...(((value as JsonRecord).results as unknown[]) || []),
        ]
      : [];
  return rows
    .map((row) => {
      if (!row || typeof row !== "object") return null;
      const raw = row as JsonRecord;
      const id = pickString(raw, ["id", "fileId"]);
      if (!id) return null;
      return {
        id,
        name: pickString(raw, ["name", "title"]) || "(Untitled)",
        mimeType: pickString(raw, ["mimeType", "mime_type"]) || "unknown",
        size: pickString(raw, ["size", "fileSize"]),
        modifiedTime: pickString(raw, ["modifiedTime", "modified_time", "modifiedDate"]),
        webViewLink: pickString(raw, ["webViewLink", "web_view_link", "url"]),
      };
    })
    .filter((entry): entry is GogDriveFile => Boolean(entry));
}

export async function listDriveFiles(params: {
  account: string;
  folderId?: string;
  max?: number;
}): Promise<GogDriveFile[]> {
  const args = [
    "drive",
    "ls",
    "--account",
    params.account,
    "--json",
    "--no-input",
  ];
  if (params.folderId) args.push(params.folderId);
  if (params.max) args.push("--max", String(params.max));
  const { stdout, stderr, code } = await runGogCommand(args, 30000);
  if (code !== 0) {
    throw new Error(stderr.trim() || stdout.trim() || "Unable to list Drive files");
  }
  return parseDriveFiles(parseJsonLoose<unknown>(stdout));
}

export async function searchDrive(params: {
  account: string;
  query: string;
  max?: number;
}): Promise<GogDriveFile[]> {
  const queryParts = joinQueryParts(params.query);
  const args = [
    "drive",
    "search",
    ...queryParts,
    "--account",
    params.account,
    "--json",
    "--no-input",
  ];
  if (params.max) args.push("--max", String(params.max));
  const { stdout, stderr, code } = await runGogCommand(args, 30000);
  if (code !== 0) {
    throw new Error(stderr.trim() || stdout.trim() || "Unable to search Drive");
  }
  return parseDriveFiles(parseJsonLoose<unknown>(stdout));
}

export async function getDriveFileMetadata(params: {
  account: string;
  fileId: string;
}): Promise<JsonRecord> {
  const args = [
    "drive",
    "get",
    params.fileId,
    "--account",
    params.account,
    "--json",
    "--no-input",
  ];
  const { stdout, stderr, code } = await runGogCommand(args, 30000);
  if (code !== 0) {
    throw new Error(stderr.trim() || stdout.trim() || "Unable to get Drive file metadata");
  }
  return parseJsonLoose<JsonRecord>(stdout);
}

export async function setupOpenClawGmailWatch(params: {
  account: string;
  projectId: string;
  label?: string;
  hookUrl?: string;
  hookToken?: string;
  topic?: string;
  subscription?: string;
  pushEndpoint?: string;
  pushToken?: string;
  port?: string;
  path?: string;
  tailscaleMode?: "funnel" | "serve" | "off";
  includeBody?: boolean;
  maxBytes?: number;
}): Promise<JsonRecord> {
  const args = [
    "webhooks",
    "gmail",
    "setup",
    "--account",
    params.account,
    "--project",
    params.projectId,
    "--json",
  ];
  if (params.label) args.push("--label", params.label);
  if (params.hookUrl) args.push("--hook-url", params.hookUrl);
  if (params.hookToken) args.push("--hook-token", params.hookToken);
  if (params.topic) args.push("--topic", params.topic);
  if (params.subscription) args.push("--subscription", params.subscription);
  if (params.pushEndpoint) args.push("--push-endpoint", params.pushEndpoint);
  if (params.pushToken) args.push("--push-token", params.pushToken);
  if (params.port) args.push("--port", params.port);
  if (params.path) args.push("--path", params.path);
  if (params.tailscaleMode) args.push("--tailscale", params.tailscaleMode);
  if (params.includeBody === false) {
    // setup defaults to true; omit flag to keep default, add false by max-bytes workaround not available
  } else {
    args.push("--include-body");
  }
  if (typeof params.maxBytes === "number" && Number.isFinite(params.maxBytes)) {
    args.push("--max-bytes", String(params.maxBytes));
  }
  const { stdout, stderr, code } = await runGogCommand(args, 60000);
  if (code !== 0) {
    throw new Error(stderr.trim() || stdout.trim() || "Unable to configure Gmail watch");
  }
  return parseJsonLoose<JsonRecord>(stdout);
}
