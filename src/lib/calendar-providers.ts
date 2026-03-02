import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";
import { mkdir, readFile, writeFile } from "fs/promises";
import { join } from "path";
import { randomUUID } from "crypto";
import { getOpenClawHome } from "@/lib/paths";
import { readCalendarEntries, writeCalendarEntries, type CalendarEntry } from "@/lib/calendar-store";

export type CalendarProviderType = "caldav";

export type CalendarProviderAccount = {
  id: string;
  type: CalendarProviderType;
  label: string;
  serverUrl: string;
  calendarUrl: string;
  username: string;
  cutoffDate?: string;
  secretRef: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  lastSyncAt?: string;
  lastError?: string;
};

type ProviderStore = {
  version: 1;
  accounts: CalendarProviderAccount[];
};

type SecretStore = {
  version: 1;
  values: Record<string, string>;
};

function providersPath(workspace: string): string {
  return join(workspace, "calendar-providers.json");
}

function credentialsDir(): string {
  return join(getOpenClawHome(), "credentials");
}

function secretPath(): string {
  return join(credentialsDir(), "calendar-provider-secrets.json");
}

function keyPath(): string {
  return join(credentialsDir(), "calendar-provider-key.bin");
}

async function getOrCreateKey(): Promise<Buffer> {
  await mkdir(credentialsDir(), { recursive: true });
  try {
    const existing = await readFile(keyPath());
    if (existing.length >= 32) return existing.subarray(0, 32);
  } catch {
    // continue
  }
  const key = randomBytes(32);
  await writeFile(keyPath(), key);
  return key;
}

function encrypt(plain: string, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64")}.${tag.toString("base64")}.${enc.toString("base64")}`;
}

function decrypt(payload: string, key: Buffer): string {
  const [ivB64, tagB64, dataB64] = payload.split(".");
  const iv = Buffer.from(ivB64, "base64");
  const tag = Buffer.from(tagB64, "base64");
  const data = Buffer.from(dataB64, "base64");
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const dec = Buffer.concat([decipher.update(data), decipher.final()]);
  return dec.toString("utf8");
}

async function readSecrets(): Promise<SecretStore> {
  try {
    const raw = await readFile(secretPath(), "utf-8");
    const parsed = JSON.parse(raw) as Partial<SecretStore>;
    return { version: 1, values: parsed.values || {} };
  } catch {
    return { version: 1, values: {} };
  }
}

async function writeSecrets(store: SecretStore): Promise<void> {
  await mkdir(credentialsDir(), { recursive: true });
  await writeFile(secretPath(), JSON.stringify(store, null, 2), "utf-8");
}

export async function putCalendarProviderSecret(secret: string): Promise<string> {
  const key = await getOrCreateKey();
  const store = await readSecrets();
  const ref = `caldav:${createHash("sha256").update(randomUUID()).digest("hex").slice(0, 18)}`;
  store.values[ref] = encrypt(secret, key);
  await writeSecrets(store);
  return ref;
}

export async function readCalendarProviderSecret(secretRef: string): Promise<string | null> {
  const key = await getOrCreateKey();
  const store = await readSecrets();
  const payload = store.values[secretRef];
  if (!payload) return null;
  try {
    return decrypt(payload, key);
  } catch {
    return null;
  }
}

export async function deleteCalendarProviderSecret(secretRef: string): Promise<void> {
  const store = await readSecrets();
  if (!store.values[secretRef]) return;
  delete store.values[secretRef];
  await writeSecrets(store);
}

export async function readCalendarProviders(workspace: string): Promise<CalendarProviderAccount[]> {
  try {
    const raw = await readFile(providersPath(workspace), "utf-8");
    const parsed = JSON.parse(raw) as Partial<ProviderStore>;
    return Array.isArray(parsed.accounts) ? parsed.accounts : [];
  } catch {
    return [];
  }
}

export async function writeCalendarProviders(workspace: string, accounts: CalendarProviderAccount[]): Promise<void> {
  await mkdir(workspace, { recursive: true });
  await writeFile(providersPath(workspace), JSON.stringify({ version: 1, accounts }, null, 2), "utf-8");
}

export async function upsertCalendarProvider(
  workspace: string,
  payload: Omit<CalendarProviderAccount, "id" | "createdAt" | "updatedAt" | "secretRef"> & {
    id?: string;
    secret?: string;
    secretRef?: string;
  }
): Promise<CalendarProviderAccount> {
  const now = new Date().toISOString();
  const accounts = await readCalendarProviders(workspace);
  const id = payload.id || randomUUID();
  const idx = accounts.findIndex((a) => a.id === id);

  let secretRef = payload.secretRef;
  const nextSecret = (payload.secret || "").trim();
  if (!secretRef || nextSecret) {
    if (!nextSecret) throw new Error("Provider secret is required for new accounts");
    secretRef = await putCalendarProviderSecret(nextSecret);
  }

  const next: CalendarProviderAccount = {
    id,
    type: payload.type,
    label: payload.label.trim(),
    serverUrl: payload.serverUrl.trim(),
    calendarUrl: payload.calendarUrl.trim(),
    username: payload.username.trim(),
    cutoffDate: payload.cutoffDate?.trim() || undefined,
    secretRef,
    enabled: payload.enabled,
    createdAt: idx >= 0 ? accounts[idx].createdAt : now,
    updatedAt: now,
    lastSyncAt: idx >= 0 ? accounts[idx].lastSyncAt : undefined,
    lastError: idx >= 0 ? accounts[idx].lastError : undefined,
  };

  if (idx >= 0) {
    if (accounts[idx].secretRef !== secretRef) {
      await deleteCalendarProviderSecret(accounts[idx].secretRef);
    }
    accounts[idx] = next;
  } else {
    accounts.push(next);
  }

  await writeCalendarProviders(workspace, accounts);
  return next;
}

export async function deleteCalendarProvider(workspace: string, id: string): Promise<boolean> {
  const accounts = await readCalendarProviders(workspace);
  const found = accounts.find((a) => a.id === id);
  if (!found) return false;
  await deleteCalendarProviderSecret(found.secretRef);
  await writeCalendarProviders(workspace, accounts.filter((a) => a.id !== id));
  return true;
}

export async function markCalendarProviderStatus(
  workspace: string,
  id: string,
  patch: { lastSyncAt?: string; lastError?: string | null }
): Promise<void> {
  const accounts = await readCalendarProviders(workspace);
  const idx = accounts.findIndex((a) => a.id === id);
  if (idx < 0) return;
  const now = new Date().toISOString();
  const current = accounts[idx];
  accounts[idx] = {
    ...current,
    lastSyncAt: patch.lastSyncAt ?? current.lastSyncAt,
    lastError: patch.lastError === null ? undefined : patch.lastError ?? current.lastError,
    updatedAt: now,
  };
  await writeCalendarProviders(workspace, accounts);
}

export async function purgeProviderEvents(workspace: string, accountId: string): Promise<number> {
  const entries = await readCalendarEntries(workspace);
  const before = entries.length;
  const kept = entries.filter((entry) => entry.providerAccountId !== accountId);
  await writeCalendarEntries(workspace, kept);
  return before - kept.length;
}

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function parseIcsField(block: string, key: string): string | null {
  const re = new RegExp(`^${key}(?:;[^:]*)?:(.+)$`, "im");
  const m = re.exec(block);
  return m?.[1]?.trim() || null;
}

function parseIcsDate(raw: string | null): string | null {
  if (!raw) return null;
  const value = raw.trim();
  if (/^\d{8}T\d{6}Z$/.test(value)) {
    const y = value.slice(0, 4);
    const mo = value.slice(4, 6);
    const d = value.slice(6, 8);
    const h = value.slice(9, 11);
    const mi = value.slice(11, 13);
    const s = value.slice(13, 15);
    return `${y}-${mo}-${d}T${h}:${mi}:${s}Z`;
  }
  if (/^\d{8}T\d{6}$/.test(value)) {
    const y = value.slice(0, 4);
    const mo = value.slice(4, 6);
    const d = value.slice(6, 8);
    const h = value.slice(9, 11);
    const mi = value.slice(11, 13);
    const s = value.slice(13, 15);
    return new Date(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s)).toISOString();
  }
  if (/^\d{8}$/.test(value)) {
    const y = value.slice(0, 4);
    const mo = value.slice(4, 6);
    const d = value.slice(6, 8);
    return new Date(Number(y), Number(mo) - 1, Number(d), 9, 0, 0).toISOString();
  }
  return null;
}

function parseCalendarData(xml: string): Array<{
  uid: string;
  kind: "event";
  title: string;
  notes?: string;
  dueAt: string;
  status: "scheduled";
}> {
  const out: Array<{
    uid: string;
    kind: "event";
    title: string;
    notes?: string;
    dueAt: string;
    status: "scheduled";
  }> = [];
  const calDataMatches = xml.matchAll(/<[^>]*calendar-data[^>]*>([\s\S]*?)<\/[^>]*calendar-data>/gi);
  for (const match of calDataMatches) {
    const ics = decodeXmlEntities(match[1] || "");
    const eventMatches = ics.matchAll(/BEGIN:VEVENT([\s\S]*?)END:VEVENT/gi);
    for (const event of eventMatches) {
      const block = event[1] || "";
      const status = (parseIcsField(block, "STATUS") || "").trim().toUpperCase();
      if (status === "CANCELLED") continue;
      const uid = parseIcsField(block, "UID");
      const title = parseIcsField(block, "SUMMARY") || "(untitled)";
      const notes = parseIcsField(block, "DESCRIPTION") || undefined;
      const dueAt = parseIcsDate(parseIcsField(block, "DTSTART"));
      if (!uid || !dueAt) continue;
      out.push({ uid, kind: "event", title, notes, dueAt, status: "scheduled" });
    }

  }
  return out;
}

function buildCalendarQueryBody(from: string, to: string): string {
  return `<?xml version="1.0" encoding="utf-8" ?>
<c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:prop>
    <d:getetag />
    <c:calendar-data />
  </d:prop>
  <c:filter>
    <c:comp-filter name="VCALENDAR">
      <c:comp-filter name="VEVENT">
        <c:time-range start="${from}" end="${to}" />
      </c:comp-filter>
    </c:comp-filter>
  </c:filter>
</c:calendar-query>`;
}

async function fetchCalDavEventsReport(
  account: CalendarProviderAccount,
  password: string,
  calendarUrl: string
): Promise<string> {
  const auth = Buffer.from(`${account.username}:${password}`).toString("base64");
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth() - 3, now.getDate()).toISOString().replace(/[-:]/g, "").slice(0, 15) + "Z";
  const to = new Date(now.getFullYear() + 1, now.getMonth(), now.getDate()).toISOString().replace(/[-:]/g, "").slice(0, 15) + "Z";
  const body = buildCalendarQueryBody(from, to);

  const res = await fetch(calendarUrl, {
    method: "REPORT",
    headers: {
      Authorization: `Basic ${auth}`,
      Depth: "1",
      "Content-Type": "application/xml; charset=utf-8",
    },
    body,
  });
  const text = await res.text();
  if (!res.ok && res.status !== 207) {
    throw new Error(`CalDAV sync failed (${res.status}): ${text.slice(0, 220)}`);
  }
  return text;
}

function toAbsUrl(base: string, href: string): string {
  try {
    return new URL(href, base).toString();
  } catch {
    return href;
  }
}

function firstTagValue(xml: string, tags: string[]): string | null {
  for (const tag of tags) {
    const re = new RegExp(`<[^>]*${tag}[^>]*>([\\s\\S]*?)<\\/[^>]*${tag}>`, "i");
    const m = re.exec(xml);
    if (m?.[1]?.trim()) return decodeXmlEntities(m[1].trim());
  }
  return null;
}

function nestedHref(xml: string, containerTag: string): string | null {
  const container = new RegExp(`<[^>]*${containerTag}[^>]*>([\\s\\S]*?)<\\/[^>]*${containerTag}>`, "i").exec(xml);
  if (!container?.[1]) return null;
  const href = /<[^>]*href[^>]*>([\s\S]*?)<\/[^>]*href>/i.exec(container[1]);
  return href?.[1] ? decodeXmlEntities(href[1].trim()) : null;
}

async function discoverCalDavCalendarUrls(account: CalendarProviderAccount, password: string): Promise<string[]> {
  const auth = Buffer.from(`${account.username}:${password}`).toString("base64");
  const baseUrl = account.serverUrl || account.calendarUrl;
  if (!baseUrl) throw new Error("serverUrl is required for CalDAV discovery");

  const principalRes = await fetch(baseUrl, {
    method: "PROPFIND",
    headers: {
      Authorization: `Basic ${auth}`,
      Depth: "0",
      "Content-Type": "application/xml; charset=utf-8",
    },
    body: "<?xml version=\"1.0\"?><d:propfind xmlns:d=\"DAV:\"><d:prop><d:current-user-principal/></d:prop></d:propfind>",
  });
  const principalXml = await principalRes.text();
  if (!principalRes.ok && principalRes.status !== 207) {
    throw new Error(`CalDAV principal discovery failed (${principalRes.status})`);
  }

  const principalHref = nestedHref(principalXml, "current-user-principal") || firstTagValue(principalXml, ["href"]);
  if (!principalHref) throw new Error("Could not resolve current-user-principal href");
  const principalUrl = toAbsUrl(baseUrl, principalHref);

  const homeRes = await fetch(principalUrl, {
    method: "PROPFIND",
    headers: {
      Authorization: `Basic ${auth}`,
      Depth: "0",
      "Content-Type": "application/xml; charset=utf-8",
    },
    body: "<?xml version=\"1.0\"?><d:propfind xmlns:d=\"DAV:\" xmlns:c=\"urn:ietf:params:xml:ns:caldav\"><d:prop><c:calendar-home-set/></d:prop></d:propfind>",
  });
  const homeXml = await homeRes.text();
  if (!homeRes.ok && homeRes.status !== 207) {
    throw new Error(`CalDAV calendar-home discovery failed (${homeRes.status})`);
  }

  const homeHref = nestedHref(homeXml, "calendar-home-set") || firstTagValue(homeXml, ["href"]);
  if (!homeHref) throw new Error("Could not resolve calendar-home-set href");
  const homeUrl = toAbsUrl(baseUrl, homeHref);

  const calendarsReq = {
    method: "PROPFIND",
    headers: {
      Authorization: `Basic ${auth}`,
      Depth: "1",
      "Content-Type": "application/xml; charset=utf-8",
    },
    body: "<?xml version=\"1.0\"?><d:propfind xmlns:d=\"DAV:\" xmlns:c=\"urn:ietf:params:xml:ns:caldav\"><d:prop><d:resourcetype/><d:displayname/></d:prop></d:propfind>",
  } as const;

  let calendarsRes = await fetch(homeUrl, calendarsReq);
  let calendarsXml = await calendarsRes.text();
  if (calendarsRes.status === 400 && !homeUrl.endsWith("/")) {
    calendarsRes = await fetch(`${homeUrl}/`, calendarsReq);
    calendarsXml = await calendarsRes.text();
  }
  if (!calendarsRes.ok && calendarsRes.status !== 207) {
    throw new Error(`CalDAV calendars list failed (${calendarsRes.status}): ${calendarsXml.slice(0, 220)}`);
  }

  const tryReport = async (url: string): Promise<boolean> => {
    try {
      await fetchCalDavEventsReport(account, password, url);
      return true;
    } catch {
      return false;
    }
  };

  const responses = [...calendarsXml.matchAll(/<[^>]*response[^>]*>([\s\S]*?)<\/[^>]*response>/gi)].map((m) => m[1] || "");
  const normalizedHome = homeUrl.replace(/\/+$/, "");
  const calendarCandidates: string[] = [];
  const fallbackCandidates: string[] = [];
  for (const response of responses) {
    const href = firstTagValue(response, ["href"]);
    if (!href) continue;
    const abs = toAbsUrl(homeUrl, href);
    if (abs.replace(/\/+$/, "") === normalizedHome) continue;
    if (/^https?:\/\//i.test(abs)) {
      fallbackCandidates.push(abs);
      const hasCalendarResource = /<[^>]*resourcetype[^>]*>[\s\S]*?<[^>]*calendar(?:\s*\/\s*>|>)/i.test(response)
        && !/calendar-home-set/i.test(response);
      if (hasCalendarResource) {
        calendarCandidates.push(abs);
      }
    }
  }

  const tried = new Set<string>();
  const okCandidates: string[] = [];
  for (const candidate of [...calendarCandidates, ...fallbackCandidates]) {
    if (tried.has(candidate)) continue;
    tried.add(candidate);
    if (await tryReport(candidate)) okCandidates.push(candidate);
  }

  if (okCandidates.length === 0) {
    throw new Error("Could not discover a calendar collection URL");
  }
  return okCandidates;
}

async function resolveCalDavCalendarUrls(account: CalendarProviderAccount, password: string): Promise<string[]> {
  const given = (account.calendarUrl || "").trim();
  const isRootHost = /^https?:\/\/[^/]+\/?$/i.test(given);
  const isCalendarHome = /\/calendars\/?$/i.test(given);
  if (!given || isRootHost || isCalendarHome) {
    return discoverCalDavCalendarUrls(account, password);
  }
  return [given];
}

export async function testCalDavConnection(account: Pick<CalendarProviderAccount, "calendarUrl" | "username">, password: string): Promise<void> {
  const auth = Buffer.from(`${account.username}:${password}`).toString("base64");
  const res = await fetch(account.calendarUrl, {
    method: "PROPFIND",
    headers: {
      Authorization: `Basic ${auth}`,
      Depth: "0",
      "Content-Type": "application/xml; charset=utf-8",
    },
    body: "<?xml version=\"1.0\"?><d:propfind xmlns:d=\"DAV:\"><d:prop><d:displayname/></d:prop></d:propfind>",
  });
  if (!res.ok && res.status !== 207) {
    const body = await res.text().catch(() => "");
    throw new Error(`Connection failed (${res.status}): ${body.slice(0, 220)}`);
  }
}

export async function testOrDiscoverCalDavConnection(
  account: Pick<CalendarProviderAccount, "serverUrl" | "calendarUrl" | "username">
  & { serverUrl: string },
  password: string
): Promise<{ calendarUrl: string }> {
  const normalized: CalendarProviderAccount = {
    id: "tmp",
    type: "caldav",
    label: "tmp",
    serverUrl: account.serverUrl,
    calendarUrl: account.calendarUrl,
    username: account.username,
    secretRef: "",
    enabled: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  const calendarUrls = await resolveCalDavCalendarUrls(normalized, password);
  const calendarUrl = calendarUrls[0];
  await testCalDavConnection({ calendarUrl, username: account.username }, password);
  return { calendarUrl };
}

export async function syncCalDavProvider(workspace: string, account: CalendarProviderAccount): Promise<number> {
  const password = await readCalendarProviderSecret(account.secretRef);
  if (!password) throw new Error("Provider password secret missing");

  const calendarUrls = await resolveCalDavCalendarUrls(account, password);
  const remoteEvents = new Map<string, ReturnType<typeof parseCalendarData>[number]>();
  for (const url of calendarUrls) {
    try {
      const evXml = await fetchCalDavEventsReport(account, password, url);
      for (const event of parseCalendarData(evXml)) remoteEvents.set(event.uid, event);
    } catch {
      // ignore collection-specific errors
    }
  }
  const entries = await readCalendarEntries(workspace);
  const kept: CalendarEntry[] = entries.filter((entry) => entry.providerAccountId !== account.id);

  const nowIso = new Date().toISOString();
  const imported: CalendarEntry[] = Array.from(remoteEvents.values())
    .filter((event) => {
      if (!account.cutoffDate) return true;
      const cutoff = new Date(account.cutoffDate).getTime();
      if (Number.isNaN(cutoff)) return true;
      return new Date(event.dueAt).getTime() >= cutoff;
    })
    .map((event) => ({
    id: `provider:${account.id}:${event.uid}`,
    kind: event.kind,
    title: event.title,
    notes: event.notes,
    dueAt: event.dueAt,
    status: event.status,
    createdAt: nowIso,
    updatedAt: nowIso,
    source: "provider",
    provider: account.type,
    providerAccountId: account.id,
    externalId: event.uid,
    readOnly: true,
    lastSyncedAt: nowIso,
  }));

  const mergedById = new Map<string, CalendarEntry>();
  for (const entry of kept) mergedById.set(entry.id, entry);
  for (const entry of imported) {
    const existing = mergedById.get(entry.id);
    mergedById.set(entry.id, {
      ...(existing || entry),
      ...entry,
      createdAt: existing?.createdAt || entry.createdAt,
    });
  }
  await writeCalendarEntries(workspace, Array.from(mergedById.values()));

  const accounts = await readCalendarProviders(workspace);
  const idx = accounts.findIndex((a) => a.id === account.id);
  if (idx >= 0) {
    accounts[idx] = { ...accounts[idx], lastSyncAt: nowIso, lastError: undefined, updatedAt: nowIso };
    await writeCalendarProviders(workspace, accounts);
  }

  return imported.length;
}
