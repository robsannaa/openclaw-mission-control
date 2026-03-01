import { NextRequest, NextResponse } from "next/server";
import { access, readFile, readdir } from "fs/promises";
import { constants as FS_CONSTANTS } from "fs";
import { join } from "path";
import { getDefaultWorkspaceSync, getOpenClawHome, getSystemSkillsDir } from "@/lib/paths";
import { gatewayCall, runCliJson } from "@/lib/openclaw";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const OPENCLAW_HOME = getOpenClawHome();
const NO_STORE_HEADERS = { "Cache-Control": "no-store" } as const;
const CREDENTIAL_KEY_RE = /(api[\s_-]?key|token|secret|password|credential|access|refresh)/i;
const ENV_CREDENTIAL_KEY_RE =
  /(api[_-]?key|token|secret|password|credential|private[_-]?key|access[_-]?key)/i;
const ENV_KEY_NAME_RE = /^[A-Z][A-Z0-9_]*$/;
const SKILL_FRONTMATTER_RE = /^---\s*\n([\s\S]*?)\n---\s*\n?/;
const ENV_NAME_RE = /\b[A-Z][A-Z0-9_]{1,}\b/g;
const VALUE_CLEAN_RE = /^["'`]|["'`,]$/g;
const GENERIC_SECTION_RE =
  /^(tools?|notes?|memory|credentials?|accounts?|keys?|users?|overview|summary|history)$/i;

type AgentListEntry = {
  id?: string;
  name?: string;
  identityName?: string;
  workspace?: string;
  agentDir?: string;
  model?: string;
  isDefault?: boolean;
};

type ModelsStatusProvider = {
  provider?: string;
  effective?: { kind?: string; detail?: string } | null;
  profiles?: {
    count?: number;
    oauth?: number;
    token?: number;
    apiKey?: number;
    labels?: string[];
  };
  env?: { value?: string; source?: string };
  modelsJson?: { source?: string };
};

type ModelsStatusOauthProfile = {
  profileId?: string;
  provider?: string;
  type?: string;
  status?: string;
  source?: string;
  label?: string;
  expiresAt?: number;
  remainingMs?: number;
};

type ModelsStatusData = {
  auth?: {
    storePath?: string;
    shellEnvFallback?: { enabled?: boolean; appliedKeys?: string[] };
    providers?: ModelsStatusProvider[];
    oauth?: { profiles?: ModelsStatusOauthProfile[] };
    unusableProfiles?: Array<{
      profileId?: string;
      provider?: string;
      kind?: string;
      until?: number;
      remainingMs?: number;
    }>;
  };
};

type ChannelsListData = {
  chat?: Record<string, string[]>;
  auth?: Array<{
    id?: string;
    provider?: string;
    type?: string;
    isExternal?: boolean;
  }>;
};

type ChannelAccountStatus = {
  accountId?: string;
  enabled?: boolean;
  configured?: boolean;
  running?: boolean;
  tokenSource?: string;
  mode?: string;
  lastError?: string | null;
  lastInboundAt?: number | null;
  lastOutboundAt?: number | null;
  lastProbeAt?: number | null;
  probe?: { ok?: boolean; bot?: { id?: string | number; username?: string } };
  bot?: { id?: string | number; username?: string };
};

type ChannelsStatusData = {
  channelAccounts?: Record<string, ChannelAccountStatus[]>;
};

type GatewayConfigGet = {
  path?: string;
  hash?: string;
  parsed?: Record<string, unknown>;
};

type AuthProfilesFile = {
  version?: number;
  profiles?: Record<string, Record<string, unknown>>;
  lastGood?: Record<string, string>;
  usageStats?: Record<
    string,
    {
      lastUsed?: number;
      errorCount?: number;
      lastFailureAt?: number;
      cooldownUntil?: number;
    }
  >;
};

type SkillsListData = {
  skills?: Array<{
    name?: string;
    source?: string;
    eligible?: boolean;
    disabled?: boolean;
    blockedByAllowlist?: boolean;
    primaryEnv?: string;
    missing?: { env?: string[] };
  }>;
};

type SkillCredentialRow = {
  name: string;
  source: string;
  eligible: boolean;
  disabled: boolean;
  blockedByAllowlist: boolean;
  primaryEnv: string | null;
  requiredEnv: string[];
  missingEnv: string[];
  ready: boolean;
  env: Array<{
    key: string;
    present: boolean;
    source: string | null;
    value: string | null;
    redacted: boolean;
  }>;
};

type DiscoveredCredentialRow = {
  sourcePath: string;
  section: string | null;
  service: string | null;
  key: string;
  value: string;
  redacted: boolean;
  confidence: "high" | "medium";
};

function jsonNoStore(body: unknown, init?: ResponseInit) {
  return NextResponse.json(body, {
    ...init,
    headers: {
      ...NO_STORE_HEADERS,
      ...(init?.headers || {}),
    },
  });
}

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
}

function asArray<T = unknown>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}

function toStringValue(v: unknown): string {
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return "";
}

function toNumberValue(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function toBoolValue(v: unknown): boolean {
  return Boolean(v);
}

function looksCredentialKey(key: string): boolean {
  return CREDENTIAL_KEY_RE.test(key);
}

function looksCredentialEnvKey(key: string): boolean {
  return ENV_CREDENTIAL_KEY_RE.test(key);
}

function isRedacted(value: string): boolean {
  return (
    value.includes("__OPENCLAW_REDACTED__") ||
    value.includes("••••") ||
    value.trim() === ""
  );
}

function cleanValue(raw: string): string {
  return raw.trim().replace(VALUE_CLEAN_RE, "").trim();
}

function looksSecretValue(value: string): boolean {
  const v = cleanValue(value);
  if (!v) return false;
  if (v.length < 12) return false;
  if (/\s/.test(v)) return false;
  if (/^https?:\/\//i.test(v)) return false;
  if (/^[./]/.test(v)) return false;
  if (/^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(v)) return false;
  if (/^[A-Za-z][A-Za-z0-9_+-]*\/[A-Za-z0-9_+-]+$/.test(v)) return false;
  if (/^@[A-Za-z0-9_]{3,}$/.test(v)) return false;
  const hasLower = /[a-z]/.test(v);
  const hasUpper = /[A-Z]/.test(v);
  const hasDigit = /[0-9]/.test(v);
  const hasSymbol = /[^A-Za-z0-9]/.test(v);
  const classes = [hasLower, hasUpper, hasDigit, hasSymbol].filter(Boolean).length;
  if (/^[a-z]{2,20}_[A-Za-z0-9._-]{10,}$/i.test(v)) return true;
  if (hasDigit && classes >= 3 && v.length >= 14) return true;
  if (hasDigit && v.length >= 20 && classes >= 2) return true;
  if (/^[A-Za-z0-9_-]{24,}$/.test(v) && hasDigit) return true;
  return false;
}

function normalizeCredentialKey(label: string): string {
  const cleaned = label
    .trim()
    .replace(/\(.*?\)/g, "")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toUpperCase();
  return cleaned || "CREDENTIAL";
}

function normalizeServiceCandidate(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;
  if (!/[a-z]/i.test(value)) return null;
  if (/[=:]/.test(value)) return null;
  const lower = value.toLowerCase();
  if (GENERIC_SECTION_RE.test(lower)) return null;
  if (lower.split(/\s+/).length > 3) return null;
  if (!/^[a-z0-9][a-z0-9 ()&+._/-]{0,40}$/i.test(value)) return null;
  return lower;
}

function serviceFromHost(host: string): string | null {
  const parts = host.split(".").filter(Boolean);
  if (parts.length < 2) return null;
  let core = parts[parts.length - 2].toLowerCase();
  if (core.startsWith("my") && core.length > 4) core = core.slice(2);
  return core || null;
}

function inferServiceName(params: {
  section: string | null;
  key: string;
  line: string;
  sourcePath: string;
}): string | null {
  const section = (params.section || "").trim();
  if (section) {
    const fromSection = normalizeServiceCandidate(section);
    if (fromSection) return fromSection;
  }

  const urlMatch = params.line.match(/https?:\/\/[^\s"'`|)]+/i);
  if (urlMatch) {
    try {
      const host = new URL(urlMatch[0]).hostname;
      const fromHost = serviceFromHost(host);
      if (fromHost) return fromHost;
    } catch {
      // ignore malformed URL snippets
    }
  }

  const keyTokens = params.key
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .filter((t) => !["api", "key", "token", "secret", "password", "access", "auth", "x"].includes(t));
  if (keyTokens.length > 0) {
    const fromKey = normalizeServiceCandidate(keyTokens[0]);
    if (fromKey) return fromKey;
  }

  const fileStem = params.sourcePath.split("/").pop()?.replace(/\.[^.]+$/, "") || "";
  if (fileStem) {
    const fromFile = normalizeServiceCandidate(fileStem);
    if (fromFile) return fromFile;
  }
  return null;
}

function pushDiscoveredCredential(
  out: DiscoveredCredentialRow[],
  dedupe: Set<string>,
  row: DiscoveredCredentialRow
) {
  const value = cleanValue(row.value);
  if (!value) return;
  const key = row.key.trim();
  if (!key) return;
  const signature = `${row.sourcePath}|${row.section || ""}|${row.service || ""}|${key}|${value}`;
  if (dedupe.has(signature)) return;
  dedupe.add(signature);
  out.push({
    ...row,
    key,
    value,
    redacted: isRedacted(value),
  });
}

function extractLineKeyValue(line: string): { label: string; value: string } | null {
  const patterns = [
    /^\s*[-*]\s*\*\*([^*]{2,100}?)(?::)?\*\*\s*:?\s*(.+)\s*$/,
    /^\s*\*\*([^*]{2,100}?)(?::)?\*\*\s*:?\s*(.+)\s*$/,
    /^\s*[-*]\s*([A-Za-z][A-Za-z0-9 _()/-]{1,100})\s*:\s*(.+)\s*$/,
    /^\s*([A-Za-z][A-Za-z0-9 _()/-]{1,100})\s*:\s*(.+)\s*$/,
  ] as const;
  for (const re of patterns) {
    const m = line.match(re);
    if (!m?.[1] || !m?.[2]) continue;
    const label = m[1].trim().replace(/[*`]/g, "");
    const value = cleanValue(m[2]);
    if (!label || !value) continue;
    return { label, value };
  }
  return null;
}

function parseCredentialText(
  text: string,
  sourcePath: string,
  out: DiscoveredCredentialRow[],
  dedupe: Set<string>
) {
  const lines = text.split(/\r?\n/);
  let currentSection: string | null = null;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const heading = line.match(/^\s{0,3}#{1,6}\s+(.+)\s*$/);
    if (heading?.[1]) {
      currentSection = heading[1].trim();
      continue;
    }

    const kv = extractLineKeyValue(line);
    if (kv) {
      const label = kv.label;
      const value = kv.value;
      const key = normalizeCredentialKey(label);
      const labelIsCredential =
        (looksCredentialKey(label) || looksCredentialKey(key)) &&
        key !== "ACCESS" &&
        key !== "REFRESH";
      if (labelIsCredential || looksSecretValue(value)) {
        pushDiscoveredCredential(out, dedupe, {
          sourcePath,
          section: currentSection,
          service: inferServiceName({ section: currentSection, key, line, sourcePath }),
          key,
          value,
          redacted: false,
          confidence: labelIsCredential ? "high" : "medium",
        });
      }
    }

    const envRe = /\b([A-Z][A-Z0-9_]{2,})\s*=\s*([^\s"'`]+)\b/g;
    for (let m = envRe.exec(line); m; m = envRe.exec(line)) {
      const key = m[1];
      const value = cleanValue(m[2]);
      if (!looksCredentialKey(key) && !looksSecretValue(value)) continue;
      pushDiscoveredCredential(out, dedupe, {
        sourcePath,
        section: currentSection,
        service: inferServiceName({ section: currentSection, key, line, sourcePath }),
        key,
        value,
        redacted: false,
        confidence: looksCredentialKey(key) ? "high" : "medium",
      });
    }

    const headerRe = /\b([A-Za-z0-9-]{2,80}(?:token|key|secret|password)[A-Za-z0-9-]{0,80})\s*:\s*([^\s"'`|]+)\b/gi;
    for (let m = headerRe.exec(line); m; m = headerRe.exec(line)) {
      const key = normalizeCredentialKey(m[1]);
      const value = cleanValue(m[2]);
      if (!looksSecretValue(value)) continue;
      pushDiscoveredCredential(out, dedupe, {
        sourcePath,
        section: currentSection,
        service: inferServiceName({ section: currentSection, key, line, sourcePath }),
        key,
        value,
        redacted: false,
        confidence: "high",
      });
    }
  }
}

async function collectDiscoveryFiles(configParsed: Record<string, unknown>): Promise<string[]> {
  const workspaceRoots = new Set<string>();
  workspaceRoots.add(getDefaultWorkspaceSync());
  workspaceRoots.add(join(OPENCLAW_HOME, "workspace"));
  const cfgAgents = asRecord(configParsed.agents);
  const cfgDefaults = asRecord(cfgAgents.defaults);
  const cfgDefaultWorkspace = toStringValue(cfgDefaults.workspace).trim();
  if (cfgDefaultWorkspace) workspaceRoots.add(cfgDefaultWorkspace);
  for (const row of asArray(cfgAgents.list)) {
    const ws = toStringValue(asRecord(row).workspace).trim();
    if (ws) workspaceRoots.add(ws);
  }

  const out = new Set<string>();
  const topCandidates = [join(OPENCLAW_HOME, "exec-approvals.json")];
  for (const root of workspaceRoots) {
    topCandidates.push(join(root, "TOOLS.md"));
    topCandidates.push(join(root, "MEMORY.md"));
    topCandidates.push(join(root, "AGENTS.md"));
    topCandidates.push(join(root, "USER.md"));
  }
  for (const p of topCandidates) {
    if (await exists(p)) out.add(p);
  }

  for (const workspaceDir of workspaceRoots) {
    try {
      const entries = await readdir(workspaceDir, { withFileTypes: true, encoding: "utf8" });
      for (const entry of entries) {
        if (!entry.isFile()) continue;
        const name = entry.name;
        if (
          name.startsWith(".env") ||
          /(tool|cred|secret|account|key|auth|env|memory|notes?)/i.test(name)
        ) {
          const full = join(workspaceDir, name);
          if (await exists(full)) out.add(full);
        }
      }
    } catch {
      // best effort
    }

    try {
      const memoryDir = join(workspaceDir, "memory");
      const entries = await readdir(memoryDir, { withFileTypes: true, encoding: "utf8" });
      const mdFiles = entries
        .filter((e) => e.isFile() && /\.md$/i.test(e.name))
        .map((e) => join(memoryDir, e.name))
        .slice(-5);
      for (const p of mdFiles) out.add(p);
    } catch {
      // best effort
    }
  }

  return [...out];
}

async function getDiscoveredCredentials(
  configParsed: Record<string, unknown>,
  warnings: string[]
): Promise<{
  rows: DiscoveredCredentialRow[];
  summary: {
    total: number;
    services: number;
    highConfidence: number;
  };
}> {
  const files = await collectDiscoveryFiles(configParsed);
  const rows: DiscoveredCredentialRow[] = [];
  const dedupe = new Set<string>();

  for (const path of files) {
    try {
      const raw = await readFile(path, "utf-8");
      parseCredentialText(raw, path, rows, dedupe);
    } catch (err) {
      warnings.push(`credential discovery failed (${path}): ${String(err)}`);
    }
  }

  rows.sort((a, b) => {
    const svcA = a.service || "";
    const svcB = b.service || "";
    if (svcA !== svcB) return svcA.localeCompare(svcB);
    if (a.key !== b.key) return a.key.localeCompare(b.key);
    return a.sourcePath.localeCompare(b.sourcePath);
  });

  const uniqueServices = new Set(rows.map((r) => r.service || "unknown"));
  const highConfidence = rows.filter((r) => r.confidence === "high").length;

  return {
    rows,
    summary: {
      total: rows.length,
      services: uniqueServices.size,
      highConfidence,
    },
  };
}

function extractFrontmatter(markdown: string): string | null {
  const match = markdown.match(SKILL_FRONTMATTER_RE);
  return match?.[1] || null;
}

function extractEnvNamesFromFrontmatter(frontmatter: string): string[] {
  const found = new Set<string>();

  const primaryEnvMatches = frontmatter.match(/primaryEnv\s*:\s*["']?([A-Z][A-Z0-9_]*)["']?/g) || [];
  for (const raw of primaryEnvMatches) {
    const m = raw.match(/([A-Z][A-Z0-9_]*)/);
    if (m?.[1]) found.add(m[1]);
  }

  const jsonEnvBlocks = frontmatter.match(/["']env["']\s*:\s*\[[^\]]*\]/g) || [];
  for (const block of jsonEnvBlocks) {
    const names = block.match(ENV_NAME_RE) || [];
    for (const n of names) {
      if (n !== "ENV") found.add(n);
    }
  }

  const yamlEnvBlock = frontmatter.match(/\n\s*env\s*:\s*\n([\s\S]*?)(?:\n\s*[A-Za-z0-9_-]+\s*:|$)/);
  if (yamlEnvBlock?.[1]) {
    const yamlNames = yamlEnvBlock[1].match(/-\s*([A-Z][A-Z0-9_]*)/g) || [];
    for (const raw of yamlNames) {
      const m = raw.match(/([A-Z][A-Z0-9_]*)/);
      if (m?.[1]) found.add(m[1]);
    }
  }

  // YAML fallback: grab uppercase list entries anywhere in frontmatter.
  const yamlUpperListNames = frontmatter.match(/^\s*-\s*([A-Z][A-Z0-9_]*)\s*$/gm) || [];
  for (const raw of yamlUpperListNames) {
    const m = raw.match(/([A-Z][A-Z0-9_]*)/);
    if (m?.[1]) found.add(m[1]);
  }

  return [...found];
}

function extractEnvNamesFromSkillMarkdown(markdown: string): string[] {
  const found = new Set<string>();
  const frontmatter = extractFrontmatter(markdown);
  if (frontmatter) {
    for (const name of extractEnvNamesFromFrontmatter(frontmatter)) {
      found.add(name);
    }
  }

  const exportMatches = markdown.match(/(?:^|\n)\s*export\s+([A-Z][A-Z0-9_]*)\s*=/g) || [];
  for (const raw of exportMatches) {
    const m = raw.match(/([A-Z][A-Z0-9_]*)/);
    if (m?.[1]) found.add(m[1]);
  }

  return [...found].sort((a, b) => a.localeCompare(b));
}

async function collectSkillMarkdownPaths() {
  const out: Array<{ name: string; source: "workspace" | "system"; path: string }> = [];
  const workspaceSkillsDir = join(getDefaultWorkspaceSync(), "skills");
  const systemSkillsDir = await getSystemSkillsDir().catch(() => "");

  const scan = async (root: string, source: "workspace" | "system") => {
    if (!root) return;
    let entries: { isDirectory(): boolean; name: string }[] = [];
    try {
      entries = await readdir(root, { withFileTypes: true, encoding: "utf8" });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const skillPath = join(root, entry.name, "SKILL.md");
      if (await exists(skillPath)) {
        out.push({ name: entry.name, source, path: skillPath });
      }
    }
  };

  await scan(workspaceSkillsDir, "workspace");
  if (systemSkillsDir !== workspaceSkillsDir) {
    await scan(systemSkillsDir, "system");
  }

  return out;
}

async function getSkillCredentialMatrix(
  configEnv: Record<string, unknown>,
  warnings: string[]
): Promise<{
  rows: SkillCredentialRow[];
  summary: {
    skills: number;
    ready: number;
    missing: number;
    envKeys: number;
    resolvedEnvKeys: number;
  };
}> {
  const skillRows = new Map<
    string,
    {
      source: string;
      eligible: boolean;
      disabled: boolean;
      blockedByAllowlist: boolean;
      primaryEnv: string | null;
      requiredEnv: Set<string>;
    }
  >();

  const skillsList = await runCliJson<SkillsListData>(["skills", "list"], 15000).catch((err) => {
    warnings.push(`skills.list failed: ${String(err)}`);
    return { skills: [] } as SkillsListData;
  });

  for (const row of asArray<NonNullable<SkillsListData["skills"]>[number]>(skillsList.skills)) {
    const name = toStringValue(row.name).trim();
    if (!name) continue;
    const current = skillRows.get(name) || {
      source: toStringValue(row.source) || "unknown",
      eligible: Boolean(row.eligible),
      disabled: Boolean(row.disabled),
      blockedByAllowlist: Boolean(row.blockedByAllowlist),
      primaryEnv: null as string | null,
      requiredEnv: new Set<string>(),
    };
    const primaryEnv = toStringValue(row.primaryEnv).trim();
    if (primaryEnv) {
      current.primaryEnv = primaryEnv;
      current.requiredEnv.add(primaryEnv);
    }
    for (const envName of asArray<string>(row.missing?.env).map((v) => String(v))) {
      if (envName) current.requiredEnv.add(envName);
    }
    current.source = toStringValue(row.source) || current.source;
    current.eligible = Boolean(row.eligible);
    current.disabled = Boolean(row.disabled);
    current.blockedByAllowlist = Boolean(row.blockedByAllowlist);
    skillRows.set(name, current);
  }

  const skillFiles = await collectSkillMarkdownPaths();
  await Promise.all(
    skillFiles.map(async (skillFile) => {
      try {
        const markdown = await readFile(skillFile.path, "utf-8");
        const envNames = extractEnvNamesFromSkillMarkdown(markdown);
        const current = skillRows.get(skillFile.name) || {
          source: skillFile.source,
          eligible: false,
          disabled: false,
          blockedByAllowlist: false,
          primaryEnv: null as string | null,
          requiredEnv: new Set<string>(),
        };
        for (const envName of envNames) current.requiredEnv.add(envName);
        if (!skillRows.has(skillFile.name)) {
          current.source = skillFile.source;
        }
        skillRows.set(skillFile.name, current);
      } catch (err) {
        warnings.push(`skill parse failed (${skillFile.name}): ${String(err)}`);
      }
    })
  );

  const rows: SkillCredentialRow[] = [...skillRows.entries()]
    .map(([name, row]) => {
      const requiredEnv = [...row.requiredEnv].sort((a, b) => a.localeCompare(b));
      const resolvedEnv = requiredEnv.map((key) => {
        const configValue = typeof configEnv[key] === "string" ? String(configEnv[key]) : "";
        const processValue = typeof process.env[key] === "string" ? String(process.env[key]) : "";
        const selectedValue = configValue || processValue || "";
        const source = configValue ? "config.env" : processValue ? "process.env" : null;
        return {
          key,
          present: Boolean(selectedValue),
          source,
          value: selectedValue || null,
          redacted: selectedValue ? isRedacted(selectedValue) : true,
        };
      });
      const missingEnv = resolvedEnv.filter((env) => !env.present).map((env) => env.key);
      const ready = requiredEnv.length > 0 && missingEnv.length === 0;
      return {
        name,
        source: row.source,
        eligible: row.eligible,
        disabled: row.disabled,
        blockedByAllowlist: row.blockedByAllowlist,
        primaryEnv: row.primaryEnv,
        requiredEnv,
        missingEnv,
        ready,
        env: resolvedEnv,
      };
    })
    .filter((row) => row.requiredEnv.length > 0)
    .sort((a, b) => a.name.localeCompare(b.name));

  const uniqueEnvKeys = new Set(rows.flatMap((row) => row.requiredEnv));
  const resolvedEnvKeys = new Set(
    rows.flatMap((row) => row.env.filter((env) => env.present).map((env) => env.key))
  );
  const readySkills = rows.filter((row) => row.ready).length;

  return {
    rows,
    summary: {
      skills: rows.length,
      ready: readySkills,
      missing: rows.length - readySkills,
      envKeys: uniqueEnvKeys.size,
      resolvedEnvKeys: resolvedEnvKeys.size,
    },
  };
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path, FS_CONSTANTS.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function readJsonSafe<T>(path: string, fallback: T): Promise<T> {
  try {
    const raw = await readFile(path, "utf-8");
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function collectConfigSecrets(
  node: unknown,
  path: string[],
  out: Array<{
    path: string;
    key: string;
    value: string;
    source: string;
    redacted: boolean;
  }>,
  depth = 0
) {
  if (depth > 12) return;
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    node.forEach((item, idx) => collectConfigSecrets(item, [...path, String(idx)], out, depth + 1));
    return;
  }
  const record = node as Record<string, unknown>;
  for (const [key, value] of Object.entries(record)) {
    if (path.length === 0 && key === "env") continue;
    const nextPath = [...path, key];
    if (typeof value === "string" && looksCredentialKey(key)) {
      out.push({
        path: nextPath.join("."),
        key,
        value,
        source: "config.parsed",
        redacted: isRedacted(value),
      });
      continue;
    }
    if (value && typeof value === "object") {
      collectConfigSecrets(value, nextPath, out, depth + 1);
    }
  }
}

async function getAgentModelStatuses(
  agents: Array<{ id: string }>
): Promise<Record<string, ModelsStatusData | null>> {
  const rows = await Promise.all(
    agents.map(async (agent) => {
      try {
        const data = await runCliJson<ModelsStatusData>(
          ["models", "status", "--agent", agent.id],
          12000
        );
        return [agent.id, data] as const;
      } catch {
        return [agent.id, null] as const;
      }
    })
  );
  return Object.fromEntries(rows);
}

function normalizeAgentRow(raw: AgentListEntry): {
  id: string;
  name: string;
  workspace: string | null;
  agentDir: string;
  model: string | null;
  isDefault: boolean;
} | null {
  const id = toStringValue(raw.id).trim();
  if (!id) return null;
  const fallbackAgentDir = join(OPENCLAW_HOME, "agents", id, "agent");
  return {
    id,
    name:
      toStringValue(raw.identityName || raw.name).trim() ||
      id,
    workspace: toStringValue(raw.workspace).trim() || null,
    agentDir: toStringValue(raw.agentDir).trim() || fallbackAgentDir,
    model: toStringValue(raw.model).trim() || null,
    isDefault: Boolean(raw.isDefault || id === "main"),
  };
}

export async function GET() {
  const warnings: string[] = [];

  const [agentsRaw, channelsListRaw, channelsStatusRaw, configGetRaw] =
    await Promise.all([
      runCliJson<AgentListEntry[]>(["agents", "list"], 10000).catch((err) => {
        warnings.push(`agents.list failed: ${String(err)}`);
        return [] as AgentListEntry[];
      }),
      runCliJson<ChannelsListData>(["channels", "list"], 10000).catch((err) => {
        warnings.push(`channels.list failed: ${String(err)}`);
        return {} as ChannelsListData;
      }),
      runCliJson<ChannelsStatusData>(["channels", "status", "--probe"], 20000).catch(
        (err) => {
          warnings.push(`channels.status failed: ${String(err)}`);
          return {} as ChannelsStatusData;
        }
      ),
      gatewayCall<GatewayConfigGet>("config.get", undefined, 15000).catch((err) => {
        warnings.push(`gateway config.get failed: ${String(err)}`);
        return null;
      }),
    ]);

  const agents = asArray<AgentListEntry>(agentsRaw)
    .map(normalizeAgentRow)
    .filter((v): v is NonNullable<typeof v> => Boolean(v));

  const modelStatusByAgent = await getAgentModelStatuses(agents);

  const agentAuthProfiles = await Promise.all(
    agents.map(async (agent) => {
      const authPath = join(agent.agentDir, "auth-profiles.json");
      const fileExists = await exists(authPath);
      if (!fileExists) {
        return {
          agentId: agent.id,
          path: authPath,
          exists: false,
          lastGood: {} as Record<string, string>,
          profiles: [] as Array<{
            id: string;
            provider: string;
            type: string;
            accountId: string | null;
            expiresAt: number | null;
            remainingMs: number | null;
            usage: {
              lastUsed: number | null;
              errorCount: number | null;
              lastFailureAt: number | null;
              cooldownUntil: number | null;
            };
            secretFields: Array<{ key: string; value: string; redacted: boolean }>;
          }>,
        };
      }
      const parsed = await readJsonSafe<AuthProfilesFile>(authPath, {});
      const usageStats = asRecord(parsed.usageStats);
      const now = Date.now();
      const profiles = Object.entries(asRecord(parsed.profiles))
        .map(([profileId, profileRaw]) => {
          const profile = asRecord(profileRaw);
          const usage = asRecord(usageStats[profileId]);
          const expiresAt = toNumberValue(profile.expires ?? profile.expiresAt);
          const secretFields = Object.entries(profile)
            .filter(([k, v]) => looksCredentialKey(k) && typeof v === "string")
            .map(([k, v]) => ({
              key: k,
              value: String(v),
              redacted: isRedacted(String(v)),
            }));
          return {
            id: profileId,
            provider: toStringValue(profile.provider) || "unknown",
            type: toStringValue(profile.type) || "unknown",
            accountId: toStringValue(profile.accountId) || null,
            expiresAt,
            remainingMs: expiresAt ? Math.max(0, expiresAt - now) : null,
            usage: {
              lastUsed: toNumberValue(usage.lastUsed),
              errorCount: toNumberValue(usage.errorCount),
              lastFailureAt: toNumberValue(usage.lastFailureAt),
              cooldownUntil: toNumberValue(usage.cooldownUntil),
            },
            secretFields,
          };
        })
        .sort((a, b) => a.id.localeCompare(b.id));
      return {
        agentId: agent.id,
        path: authPath,
        exists: true,
        lastGood: asRecord(parsed.lastGood) as Record<string, string>,
        profiles,
      };
    })
  );

  const modelAuthByAgent = agents.map((agent) => {
    const status = modelStatusByAgent[agent.id];
    const auth = asRecord(status?.auth);
    const providers = asArray<ModelsStatusProvider>(auth.providers)
      .map((provider) => {
        const p = asRecord(provider);
        const effective = asRecord(p.effective);
        const profiles = asRecord(p.profiles);
        const env = asRecord(p.env);
        const modelsJson = asRecord(p.modelsJson);
        return {
          provider: toStringValue(p.provider) || "unknown",
          connected: Boolean(p.effective),
          effectiveKind: toStringValue(effective.kind) || null,
          effectiveDetail: toStringValue(effective.detail) || null,
          profileCount: Number(profiles.count || 0),
          oauthCount: Number(profiles.oauth || 0),
          tokenCount: Number(profiles.token || 0),
          apiKeyCount: Number(profiles.apiKey || 0),
          labels: asArray<string>(profiles.labels).map((v) => String(v)),
          envSource: toStringValue(env.source) || null,
          envValue: toStringValue(env.value) || null,
          modelsJsonSource: toStringValue(modelsJson.source) || null,
        };
      })
      .sort((a, b) => a.provider.localeCompare(b.provider));

    const oauthProfiles = asArray<ModelsStatusOauthProfile>(asRecord(auth.oauth).profiles)
      .map((row) => ({
        profileId: toStringValue(row.profileId),
        provider: toStringValue(row.provider),
        type: toStringValue(row.type),
        status: toStringValue(row.status),
        source: toStringValue(row.source),
        label: toStringValue(row.label),
        expiresAt: toNumberValue(row.expiresAt),
        remainingMs: toNumberValue(row.remainingMs),
      }))
      .sort((a, b) => a.profileId.localeCompare(b.profileId));

    const unusableProfiles = asArray(auth.unusableProfiles).map((row) => {
      const r = asRecord(row);
      return {
        profileId: toStringValue(r.profileId),
        provider: toStringValue(r.provider),
        kind: toStringValue(r.kind),
        until: toNumberValue(r.until),
        remainingMs: toNumberValue(r.remainingMs),
      };
    });

    const shellEnvFallback = asRecord(auth.shellEnvFallback);

    return {
      agentId: agent.id,
      storePath: toStringValue(auth.storePath) || null,
      shellEnvFallback: {
        enabled: toBoolValue(shellEnvFallback.enabled),
        appliedKeys: asArray<string>(shellEnvFallback.appliedKeys).map((v) => String(v)),
      },
      providers,
      oauthProfiles,
      unusableProfiles,
    };
  });

  const channelAccounts = Object.entries(asRecord(channelsStatusRaw.channelAccounts))
    .flatMap(([channel, accounts]) =>
      asArray<ChannelAccountStatus>(accounts).map((acct) => ({
        channel,
        accountId: toStringValue(acct.accountId) || "default",
        enabled: Boolean(acct.enabled),
        configured: Boolean(acct.configured),
        running: Boolean(acct.running),
        tokenSource: toStringValue(acct.tokenSource) || null,
        mode: toStringValue(acct.mode) || null,
        lastError: toStringValue(acct.lastError) || null,
        probeOk: acct.probe && typeof acct.probe.ok === "boolean" ? acct.probe.ok : null,
        botId: toStringValue(acct.bot?.id ?? acct.probe?.bot?.id) || null,
        botUsername:
          toStringValue(acct.bot?.username ?? acct.probe?.bot?.username) || null,
        lastInboundAt: toNumberValue(acct.lastInboundAt),
        lastOutboundAt: toNumberValue(acct.lastOutboundAt),
        lastProbeAt: toNumberValue(acct.lastProbeAt),
      }))
    )
    .sort((a, b) => {
      if (a.channel !== b.channel) return a.channel.localeCompare(b.channel);
      return a.accountId.localeCompare(b.accountId);
    });

  const parsedConfig = asRecord(configGetRaw?.parsed);
  const configEnv = asRecord(parsedConfig.env);
  const skillCredentials = await getSkillCredentialMatrix(configEnv, warnings);
  const discoveredCredentials = await getDiscoveredCredentials(parsedConfig, warnings);
  const configEnvCredentials = Object.entries(configEnv)
    .filter(([k, v]) => looksCredentialEnvKey(k) && typeof v === "string")
    .map(([k, v]) => ({
      key: k,
      value: String(v),
      source: "config.env",
      redacted: isRedacted(String(v)),
    }))
    .sort((a, b) => a.key.localeCompare(b.key));

  const processEnvCredentials = Object.entries(process.env)
    .filter(([k, v]) => looksCredentialEnvKey(k) && typeof v === "string")
    .filter(([k]) => !(k in configEnv))
    .map(([k, v]) => ({
      key: k,
      value: String(v),
      source: "process.env",
      redacted: isRedacted(String(v)),
    }))
    .sort((a, b) => a.key.localeCompare(b.key));

  const configSecrets: Array<{
    path: string;
    key: string;
    value: string;
    source: string;
    redacted: boolean;
  }> = [];
  collectConfigSecrets(parsedConfig, [], configSecrets);
  configSecrets.sort((a, b) => a.path.localeCompare(b.path));

  const modelProviderRows = modelAuthByAgent.flatMap((row) => row.providers);
  const providerConnected = modelProviderRows.filter((p) => p.connected).length;
  const totalProfiles = agentAuthProfiles.reduce((sum, row) => sum + row.profiles.length, 0);
  const runningChannelAccounts = channelAccounts.filter((row) => row.running).length;

  return jsonNoStore({
    generatedAt: Date.now(),
    configPath: configGetRaw?.path || join(OPENCLAW_HOME, "openclaw.json"),
    configHash: configGetRaw?.hash || null,
    sourceOfTruth: {
      gatewayConfig: Boolean(configGetRaw),
      channelsStatus: Object.keys(asRecord(channelsStatusRaw.channelAccounts)).length > 0,
      modelsStatus: modelAuthByAgent.some((row) => row.providers.length > 0),
    },
    summary: {
      agents: agents.length,
      modelProvidersConnected: providerConnected,
      modelProvidersTotal: modelProviderRows.length,
      authProfiles: totalProfiles,
      channelAccounts: channelAccounts.length,
      channelAccountsRunning: runningChannelAccounts,
      configEnvKeys: configEnvCredentials.length,
      processEnvKeys: processEnvCredentials.length,
      configSecrets: configSecrets.length,
      skillCredentialServices: skillCredentials.summary.skills,
      skillCredentialReady: skillCredentials.summary.ready,
      skillCredentialEnvKeys: skillCredentials.summary.envKeys,
      discoveredCredentials: discoveredCredentials.summary.total,
      discoveredCredentialServices: discoveredCredentials.summary.services,
    },
    agents,
    modelAuthByAgent,
    agentAuthProfiles,
    channels: {
      chat: asRecord(channelsListRaw.chat),
      auth: asArray(channelsListRaw.auth).map((row) => {
        const r = asRecord(row);
        return {
          id: toStringValue(r.id),
          provider: toStringValue(r.provider),
          type: toStringValue(r.type),
          isExternal: Boolean(r.isExternal),
        };
      }),
      accounts: channelAccounts,
    },
    envCredentials: {
      config: configEnvCredentials,
      process: processEnvCredentials,
    },
    skillCredentials: {
      skills: skillCredentials.rows,
      summary: skillCredentials.summary,
    },
    discoveredCredentials: {
      entries: discoveredCredentials.rows,
      summary: discoveredCredentials.summary,
    },
    configSecrets,
    warnings,
  });
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      action?: string;
      key?: string;
      value?: string;
    };
    const action = toStringValue(body.action).trim().toLowerCase();

    if (action !== "update-env-key") {
      return jsonNoStore({ ok: false, error: `Unknown action: ${action || "(empty)"}` }, { status: 400 });
    }

    const key = toStringValue(body.key).trim().toUpperCase();
    const value = toStringValue(body.value);

    if (!ENV_KEY_NAME_RE.test(key)) {
      return jsonNoStore(
        { ok: false, error: "Invalid env key name. Use uppercase letters, numbers, and underscores." },
        { status: 400 }
      );
    }
    if (!value.trim()) {
      return jsonNoStore({ ok: false, error: "Value cannot be empty." }, { status: 400 });
    }

    const cfg = await gatewayCall<GatewayConfigGet>("config.get", undefined, 15000);
    const baseHash = String(cfg.hash || "");
    if (!baseHash) {
      return jsonNoStore({ ok: false, error: "Missing config hash from gateway." }, { status: 500 });
    }

    await gatewayCall(
      "config.patch",
      {
        raw: JSON.stringify({ env: { [key]: value } }),
        baseHash,
        restartDelayMs: 2000,
      },
      20000
    );

    return jsonNoStore({ ok: true, action, key });
  } catch (err) {
    return jsonNoStore(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
