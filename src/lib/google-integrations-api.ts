import {
  getGogAuthStatus,
  getGogAvailability,
  listGogStoredAccounts,
} from "@/lib/gog-google";
import {
  extractAgentsList,
  fetchConfig,
} from "@/lib/gateway-config";
import {
  getGoogleAgentPolicy,
  GOOGLE_CAPABILITY_DEFINITIONS,
  isCapabilityEnabledForAccount,
  readGoogleIntegrationsStore,
  type GoogleAccountRecord,
  type GoogleIntegrationsStore,
  type GoogleAgentPolicy,
} from "@/lib/google-integrations-store";

export type IntegrationAgentSummary = {
  id: string;
  name: string;
  isDefault: boolean;
};

export type IntegrationCheckItem = {
  key:
    | "account-connected"
    | "gmail-access"
    | "calendar-access"
    | "drive-access"
    | "write-policy"
    | "gmail-watch";
  label: string;
  ok: boolean;
  detail: string;
  fixAction: string | null;
};

export type IntegrationAccountDiagnostics = {
  accountId: string;
  generatedAt: number;
  checks: IntegrationCheckItem[];
};

async function listAgents(): Promise<IntegrationAgentSummary[]> {
  try {
    const config = await fetchConfig();
    return extractAgentsList(config)
      .filter((entry) => entry.id)
      .map((entry) => ({
        id: entry.id,
        name:
          typeof entry.name === "string" && entry.name.trim()
            ? entry.name.trim()
            : entry.id,
        isDefault: entry.default === true,
      }))
      .sort(
        (a, b) =>
          Number(b.isDefault) - Number(a.isDefault) || a.name.localeCompare(b.name),
      );
  } catch {
    return [];
  }
}

export function buildAccountDiagnostics(
  store: GoogleIntegrationsStore,
  account: GoogleAccountRecord,
  agentId: string | null,
): IntegrationAccountDiagnostics {
  const writeCapabilities = GOOGLE_CAPABILITY_DEFINITIONS.filter(
    (capability) => capability.category === "write" && isCapabilityEnabledForAccount(account, capability.key),
  );

  const writePolicies = agentId
    ? writeCapabilities.map((capability) =>
        getGoogleAgentPolicy(store, account.id, agentId, capability.key),
      )
    : [];

  const writePolicyState: GoogleAgentPolicy | "mixed" | "none" =
    writePolicies.length === 0
      ? "none"
      : writePolicies.every((policy) => policy === "ask")
        ? "ask"
        : writePolicies.every((policy) => policy === "allow")
          ? "allow"
          : writePolicies.every((policy) => policy === "deny")
            ? "deny"
            : "mixed";

  return {
    accountId: account.id,
    generatedAt: Date.now(),
    checks: [
      {
        key: "account-connected",
        label: "Google account connected",
        ok: account.status === "connected" || account.status === "limited-access",
        detail:
          account.status === "connected"
            ? "The Google account is connected and usable."
            : account.status === "limited-access"
              ? "The account is connected, but one or more services need attention."
              : "The account still needs sign-in or reauthorization.",
        fixAction:
          account.status === "connected" || account.status === "limited-access"
            ? null
            : "Reconnect",
      },
      {
        key: "gmail-access",
        label: "Gmail access verified",
        ok: account.serviceStates.gmail.apiStatus === "ready",
        detail:
          account.serviceStates.gmail.apiStatus === "ready"
            ? `Gmail access is ready with ${account.serviceStates.gmail.scopeStatus} scope.`
            : account.serviceStates.gmail.lastError || "Gmail access has not been verified yet.",
        fixAction:
          account.serviceStates.gmail.apiStatus === "ready"
            ? null
            : "Check Access",
      },
      {
        key: "calendar-access",
        label: "Calendar access verified",
        ok: account.serviceStates.calendar.apiStatus === "ready",
        detail:
          account.serviceStates.calendar.apiStatus === "ready"
            ? `Calendar access is ready with ${account.serviceStates.calendar.scopeStatus} scope.`
            : account.serviceStates.calendar.lastError || "Calendar access has not been verified yet.",
        fixAction:
          account.serviceStates.calendar.apiStatus === "ready"
            ? null
            : "Check Access",
      },
      {
        key: "drive-access",
        label: "Drive access verified",
        ok: account.serviceStates.drive.apiStatus === "ready",
        detail:
          account.serviceStates.drive.apiStatus === "ready"
            ? `Drive access is ready with ${account.serviceStates.drive.scopeStatus} scope.`
            : account.serviceStates.drive.lastError || "Drive access has not been verified yet.",
        fixAction:
          account.serviceStates.drive.apiStatus === "ready"
            ? null
            : "Check Access",
      },
      {
        key: "write-policy",
        label: "Write actions require approval",
        ok: writePolicyState === "ask" || writePolicyState === "none",
        detail:
          writePolicyState === "ask"
            ? "Every enabled write action is currently set to Requires Approval."
            : writePolicyState === "none"
              ? "No write actions are enabled for this account right now."
              : writePolicyState === "allow"
                ? "One or more write actions are allowed automatically."
                : writePolicyState === "deny"
                  ? "All write actions are denied."
                  : "Write actions are mixed across Denied, Approval, and Allowed.",
        fixAction:
          writePolicyState === "ask" || writePolicyState === "none"
            ? null
            : "Update Permissions",
      },
      {
        key: "gmail-watch",
        label: "Incoming email watch active",
        ok:
          account.watch.enabled &&
          (account.watch.status === "configured" || account.watch.status === "watching"),
        detail:
          account.watch.enabled &&
          (account.watch.status === "configured" || account.watch.status === "watching")
            ? `Gmail watch is ${account.watch.status}.`
            : account.watch.lastError || "Incoming email monitoring is off or not configured.",
        fixAction:
          account.watch.enabled &&
          (account.watch.status === "configured" || account.watch.status === "watching")
            ? null
            : "Enable Watch",
      },
    ],
  };
}

export async function buildGoogleIntegrationsSnapshot(agentId: string | null = null) {
  const [store, agents, gogAvailability, authStatus, storedAccounts] = await Promise.all([
    readGoogleIntegrationsStore(),
    listAgents(),
    getGogAvailability().catch(() => ({
      available: false,
      bin: null,
    })),
    getGogAuthStatus().catch(() => ({
      credentialsExists: false,
      credentialsPath: null,
      keyringBackend: null,
      keyringSource: null,
      serviceAccountConfigured: false,
    })),
    listGogStoredAccounts().catch(() => []),
  ]);

  const selectedAgentId =
    agentId && agents.some((entry) => entry.id === agentId)
      ? agentId
      : (agents.find((entry) => entry.isDefault) || agents[0] || null)?.id || null;

  return {
    generatedAt: Date.now(),
    runtime: {
      gog: gogAvailability,
      auth: authStatus,
      storedAccounts,
      supportsGmailWatch: true,
    },
    agents,
    selectedAgentId,
    capabilities: GOOGLE_CAPABILITY_DEFINITIONS,
    store: {
      ...store,
      accounts: store.accounts.map((account) => ({
        ...account,
        capabilityMatrix: GOOGLE_CAPABILITY_DEFINITIONS.map((capability) => ({
          ...capability,
          enabled: isCapabilityEnabledForAccount(account, capability.key),
          policy: selectedAgentId
            ? getGoogleAgentPolicy(store, account.id, selectedAgentId, capability.key)
            : null,
        })),
        diagnostics: buildAccountDiagnostics(store, account, selectedAgentId),
      })),
    },
  };
}

export async function getGoogleAccountDetail(
  accountId: string,
  agentId: string | null = null,
) {
  const snapshot = await buildGoogleIntegrationsSnapshot(agentId);
  const account = snapshot.store.accounts.find((entry) => entry.id === accountId);
  if (!account) {
    throw new Error(`Google account not found: ${accountId}`);
  }
  return {
    generatedAt: snapshot.generatedAt,
    selectedAgentId: snapshot.selectedAgentId,
    agents: snapshot.agents,
    account,
    approvals: snapshot.store.approvals.filter((entry) => entry.accountId === accountId),
    audit: snapshot.store.audit.filter((entry) => entry.accountId === accountId),
  };
}

export async function getGoogleApprovals(agentId: string | null = null) {
  const snapshot = await buildGoogleIntegrationsSnapshot(agentId);
  return {
    generatedAt: snapshot.generatedAt,
    selectedAgentId: snapshot.selectedAgentId,
    approvals: snapshot.store.approvals,
  };
}

export async function getGoogleAccountHistory(
  accountId: string,
  agentId: string | null = null,
) {
  const detail = await getGoogleAccountDetail(accountId, agentId);
  return {
    generatedAt: detail.generatedAt,
    accountId,
    audit: detail.audit,
  };
}

export async function getGoogleAccountWatch(
  accountId: string,
  agentId: string | null = null,
) {
  const detail = await getGoogleAccountDetail(accountId, agentId);
  return {
    generatedAt: detail.generatedAt,
    accountId,
    watch: detail.account.watch,
  };
}

export async function getGoogleAccountHealth(
  accountId: string,
  agentId: string | null = null,
) {
  const detail = await getGoogleAccountDetail(accountId, agentId);
  return {
    generatedAt: detail.generatedAt,
    accountId,
    diagnostics: detail.account.diagnostics,
  };
}
