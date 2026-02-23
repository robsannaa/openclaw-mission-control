import { redirect } from "next/navigation";
import { RouteSectionView } from "@/components/route-section-view";

type SearchParams = Record<string, string | string[] | undefined>;

const SECTION_TO_PATH: Record<string, string> = {
  dashboard: "/dashboard",
  chat: "/chat",
  agents: "/agents",
  tasks: "/tasks",
  cron: "/cron",
  heartbeat: "/heartbeat",
  sessions: "/sessions",
  channels: "/channels",
  system: "/channels",
  memory: "/memory",
  memories: "/memory",
  docs: "/docs",
  documents: "/docs",
  config: "/config",
  settings: "/config",
  skills: "/skills",
  models: "/models",
  accounts: "/accounts",
  audio: "/audio",
  vectors: "/vectors",
  logs: "/logs",
  usage: "/usage",
  terminal: "/terminal",
  permissions: "/permissions",
  tailscale: "/tailscale",
  browser: "/browser",
  calendar: "/calendar",
  search: "/search",
};

function firstParam(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] || null;
  return typeof value === "string" ? value : null;
}

function appendParam(
  out: URLSearchParams,
  key: string,
  value: string | string[] | undefined
) {
  if (Array.isArray(value)) {
    for (const v of value) out.append(key, v);
    return;
  }
  if (typeof value === "string") out.set(key, value);
}

export default async function Home({
  searchParams,
}: {
  searchParams?: Promise<SearchParams>;
}) {
  const paramsObj = (searchParams ? await searchParams : {}) || {};

  const section = firstParam(paramsObj.section);
  if (section) {
    const targetPath = SECTION_TO_PATH[section.toLowerCase()] || "/dashboard";
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(paramsObj)) {
      if (key === "section") continue;
      appendParam(query, key, value);
    }
    const suffix = query.toString();
    redirect(suffix ? `${targetPath}?${suffix}` : targetPath);
  }

  return <RouteSectionView section="dashboard" />;
}
