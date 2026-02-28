/**
 * Human-readable translation layer for doctor CLI output.
 *
 * Maps raw doctor output patterns to plain-English titles,
 * explanations, categories, and fix modes.
 */

export type DoctorIssue = {
  severity: "error" | "warning" | "info";
  checkId: string;
  rawText: string;
  title: string;
  detail: string;
  fixable: boolean;
  fixMode?: "repair" | "repair-force" | "generate-token" | "restart";
  category: string;
};

type PatternEntry = {
  pattern: RegExp;
  checkId: string;
  title: string;
  detail: string;
  severity: "error" | "warning" | "info";
  fixable: boolean;
  fixMode?: DoctorIssue["fixMode"];
  category: string;
};

const PATTERN_DICTIONARY: PatternEntry[] = [
  {
    pattern: /chmod\s+600|permission.*config|config.*permission/i,
    checkId: "config-permissions",
    title: "Config file permissions need tightening",
    detail: "Your config file can be read by other users on this computer. This is a security risk because it may contain API keys.",
    severity: "warning",
    fixable: true,
    fixMode: "repair",
    category: "Configuration",
  },
  {
    pattern: /port.*collision|port.*busy|address.*in.*use/i,
    checkId: "port-collision",
    title: "Another program is using the gateway port",
    detail: "The gateway port is in use by another application. The gateway cannot start until this is resolved.",
    severity: "error",
    fixable: false,
    category: "Gateway",
  },
  {
    pattern: /legacy.*config|migration.*needed|old.*format|migrate.*config/i,
    checkId: "legacy-config",
    title: "Old configuration format detected",
    detail: "Some settings are in an older format. Updating them ensures compatibility with newer features.",
    severity: "warning",
    fixable: true,
    fixMode: "repair",
    category: "Configuration",
  },
  {
    pattern: /oauth.*expir|token.*expir|auth.*expir|session.*expir/i,
    checkId: "oauth-expired",
    title: "Login session has expired",
    detail: "Your authentication token has expired. Sign in again to continue using connected services.",
    severity: "warning",
    fixable: true,
    fixMode: "repair",
    category: "Security",
  },
  {
    pattern: /gateway.*not\s+running|gateway.*offline|gateway.*stopped|gateway.*down/i,
    checkId: "gateway-offline",
    title: "Gateway is not running",
    detail: "The background service that powers OpenClaw is stopped. Most features won't work until it's restarted.",
    severity: "error",
    fixable: true,
    fixMode: "restart",
    category: "Gateway",
  },
  {
    pattern: /sandbox.*repair|sandbox.*broken|sandbox.*damaged/i,
    checkId: "sandbox-repair",
    title: "Sandbox environment needs repair",
    detail: "The isolated environment for running code safely is damaged.",
    severity: "error",
    fixable: true,
    fixMode: "repair-force",
    category: "Security",
  },
  {
    pattern: /supervisor.*config|service.*manager.*config|launchd.*config|systemd.*config/i,
    checkId: "supervisor-config",
    title: "Service manager configuration issue",
    detail: "The system service that keeps OpenClaw running has a configuration problem.",
    severity: "warning",
    fixable: true,
    fixMode: "repair-force",
    category: "Services",
  },
  {
    pattern: /token.*missing|gateway.*token.*missing|security.*token.*not/i,
    checkId: "gateway-token-missing",
    title: "Gateway security token is missing",
    detail: "A security token needed for secure communication hasn't been created yet.",
    severity: "warning",
    fixable: true,
    fixMode: "generate-token",
    category: "Security",
  },
  {
    pattern: /stale.*ui|protocol.*fresh|ui.*rebuild|interface.*out.*date/i,
    checkId: "stale-ui",
    title: "Interface is out of date",
    detail: "The web interface needs a rebuild to match the latest version.",
    severity: "warning",
    fixable: true,
    fixMode: "repair",
    category: "Configuration",
  },
  {
    pattern: /ssl.*cert.*expir|tls.*cert.*expir|certificate.*expir/i,
    checkId: "cert-expired",
    title: "SSL certificate has expired",
    detail: "The security certificate for encrypted connections has expired. Connections may fail.",
    severity: "error",
    fixable: true,
    fixMode: "repair",
    category: "Security",
  },
  {
    pattern: /disk.*space|storage.*full|no.*space.*left/i,
    checkId: "disk-space",
    title: "Low disk space",
    detail: "The system is running low on disk space. This may prevent logs, sessions, and other data from being saved.",
    severity: "warning",
    fixable: false,
    category: "Services",
  },
  {
    pattern: /skill.*broken|skill.*error|skill.*missing.*dep/i,
    checkId: "skill-broken",
    title: "A skill has errors",
    detail: "One or more installed skills have missing dependencies or configuration errors.",
    severity: "warning",
    fixable: true,
    fixMode: "repair",
    category: "Skills & Channels",
  },
  {
    pattern: /channel.*disconnect|channel.*error|channel.*fail/i,
    checkId: "channel-error",
    title: "Channel connection issue",
    detail: "One or more communication channels are disconnected or failing.",
    severity: "warning",
    fixable: true,
    fixMode: "repair",
    category: "Skills & Channels",
  },
  {
    pattern: /memory.*corrupt|memory.*repair|vector.*corrupt/i,
    checkId: "memory-corrupt",
    title: "Memory store needs repair",
    detail: "The agent's memory or vector database has corruption that needs fixing.",
    severity: "error",
    fixable: true,
    fixMode: "repair-force",
    category: "Services",
  },
  {
    pattern: /cron.*stale|cron.*stuck|scheduled.*job.*fail/i,
    checkId: "cron-stale",
    title: "Scheduled jobs are stuck",
    detail: "One or more scheduled jobs haven't run as expected and may need attention.",
    severity: "warning",
    fixable: true,
    fixMode: "repair",
    category: "Services",
  },
  {
    pattern: /dns.*fail|dns.*resolv|network.*unreachable/i,
    checkId: "network-dns",
    title: "Network connectivity issue",
    detail: "DNS resolution or network connectivity is failing. Online features won't work.",
    severity: "error",
    fixable: false,
    category: "Services",
  },
  {
    pattern: /api.*key.*invalid|api.*key.*missing|model.*key.*missing/i,
    checkId: "api-key-invalid",
    title: "API key is missing or invalid",
    detail: "Your AI model API key is not configured or has been rejected by the provider.",
    severity: "error",
    fixable: false,
    category: "Configuration",
  },
  {
    pattern: /^(?!.*\bnot\b)(?!.*\binvalid\b)(?!.*\bfail).*(?:config.*schema.*valid|config.*valid|schema.*ok)/i,
    checkId: "config-schema-ok",
    title: "Configuration schema is valid",
    detail: "Your configuration file matches the expected format.",
    severity: "info",
    fixable: false,
    category: "Configuration",
  },
  {
    pattern: /^(?!.*\bnot\b)(?!.*\bstopped\b)(?!.*\bfail)(?!.*\boffline\b).*(?:gateway.*running|gateway.*healthy|gateway.*ok)/i,
    checkId: "gateway-healthy",
    title: "Gateway is running",
    detail: "The gateway service is up and responding normally.",
    severity: "info",
    fixable: false,
    category: "Gateway",
  },
  {
    pattern: /^(?!.*\bnot\b)(?!.*\bfail)(?!.*\bunreachable\b).*(?:rpc.*ok|rpc.*reachable|rpc.*healthy)/i,
    checkId: "rpc-healthy",
    title: "RPC is reachable",
    detail: "The internal RPC interface is responding to health checks.",
    severity: "info",
    fixable: false,
    category: "Gateway",
  },
  {
    pattern: /^(?!.*\bnot\b)(?!.*\bfail)(?!.*\bbroken\b).*(?:sandbox.*ok|sandbox.*healthy)/i,
    checkId: "sandbox-ok",
    title: "Sandbox is healthy",
    detail: "The code execution sandbox is configured and working correctly.",
    severity: "info",
    fixable: false,
    category: "Security",
  },
  {
    pattern: /^(?!.*\bnot\b)(?!.*\bexpir)(?!.*\binvalid\b)(?!.*\bfail).*(?:oauth.*ok|token.*valid|auth.*ok)/i,
    checkId: "auth-ok",
    title: "Authentication is valid",
    detail: "Your login tokens and authentication are current.",
    severity: "info",
    fixable: false,
    category: "Security",
  },
  {
    pattern: /tailscale.*not.*connect|tailscale.*offline/i,
    checkId: "tailscale-offline",
    title: "Tailscale is not connected",
    detail: "The Tailscale VPN is not connected. Remote access features won't work.",
    severity: "warning",
    fixable: false,
    category: "Services",
  },
  {
    pattern: /update.*available|new.*version|upgrade.*available/i,
    checkId: "update-available",
    title: "An update is available",
    detail: "A newer version of OpenClaw is available. Consider updating for bug fixes and new features.",
    severity: "info",
    fixable: false,
    category: "Recommendations",
  },
  {
    pattern: /recommend.*backup|backup.*recommend|no.*recent.*backup/i,
    checkId: "backup-recommended",
    title: "Backup recommended",
    detail: "It's been a while since your last backup. Consider backing up your configuration and data.",
    severity: "info",
    fixable: false,
    category: "Recommendations",
  },
];

const ANSI_RE = /\u001B\[[0-9;]*m/g;

function cleanLine(raw: string): string {
  return raw
    .replace(ANSI_RE, "")
    .replace(/^\s*[|│┌┐└┘├┤╭╮╯╰─━╶╴]+\s*/, "")
    .replace(/\s*[|│┌┐└┘├┤╭╮╯╰─━╶╴]+\s*$/, "")
    .replace(/^[\s✓✗⚠●▸►•·→←]+/, "")
    .trim();
}

// Lines that are just stats/labels from tables (e.g. "Missing requirements: 27")
const STATS_LINE_RE = /^[\w\s]+:\s*\d+\s*$/;

function classifySeverityFallback(text: string): "error" | "warning" | "info" | null {
  const line = text.toLowerCase();
  if (/^\s*$/.test(line)) return null;
  // Skip table stats lines — they're informational, not actionable
  if (STATS_LINE_RE.test(text.trim())) return null;
  if (/no\s+.*warnings?/.test(line) || /no\s+.*errors?/.test(line)) return "info";
  // "errors: 0" is info, not an error
  if (/\berrors?:\s*0\b/.test(line)) return "info";
  if (
    /\b(error|failed|failure|offline|unhealthy|not running|cannot|invalid|denied|refused)\b/.test(line)
  ) {
    return "error";
  }
  if (
    /\b(warn|warning|stale|legacy|repair|restart|collision|not loaded|expired)\b/.test(line)
  ) {
    return "warning";
  }
  if (/\b(ok|healthy|complete|running|pass|good)\b/.test(line)) return "info";
  return null;
}

export function classifyDoctorLine(line: string): DoctorIssue | null {
  const cleaned = cleanLine(line);
  if (!cleaned) return null;

  for (const entry of PATTERN_DICTIONARY) {
    if (entry.pattern.test(cleaned) || entry.pattern.test(line)) {
      return {
        severity: entry.severity,
        checkId: entry.checkId,
        rawText: cleaned,
        title: entry.title,
        detail: entry.detail,
        fixable: entry.fixable,
        fixMode: entry.fixMode,
        category: entry.category,
      };
    }
  }

  const severity = classifySeverityFallback(cleaned);
  if (!severity) return null;

  const title = cleaned.length > 80 ? cleaned.slice(0, 77) + "..." : cleaned;
  return {
    severity,
    checkId: "unknown",
    rawText: cleaned,
    title,
    detail: cleaned,
    fixable: false,
    category: severity === "error" ? "Gateway" : severity === "warning" ? "Configuration" : "Recommendations",
  };
}

export function classifyDoctorOutput(lines: string[]): DoctorIssue[] {
  const seen = new Set<string>();
  const issues: DoctorIssue[] = [];

  for (const line of lines) {
    const issue = classifyDoctorLine(line);
    if (!issue) continue;
    const key = `${issue.checkId}:${issue.severity}:${issue.title}`;
    if (seen.has(key)) continue;
    seen.add(key);
    issues.push(issue);
  }

  const severityRank = { error: 0, warning: 1, info: 2 };
  issues.sort((a, b) => severityRank[a.severity] - severityRank[b.severity]);

  return issues;
}
