export type AgentId =
  | "project-astra"
  | "henry"
  | "zoe"
  | "codex"
  | "claude"
  | "charlie"
  | "scout"
  | "pixel"
  | "quill"
  | "nexus"
  | "echo"
  | "main";

export type RoutingRule = {
  agentId: AgentId;
  keywords: string[];
  checklist: string[];
};

export const ROUTING_RULES: RoutingRule[] = [
  {
    agentId: "claude",
    keywords: ["frontend", "ui", "component", "react", "tailwind", "shadcn", "css", "layout"],
    checklist: [
      "UI state and acceptance criteria are explicit",
      "Screenshots or visual reference attached",
      "A11y constraints included",
    ],
  },
  {
    agentId: "codex",
    keywords: ["backend", "api", ".net", "sql", "migration", "architecture", "performance", "refactor"],
    checklist: [
      "API contract defined",
      "Migration/risk notes included",
      "Test scope listed",
    ],
  },
  {
    agentId: "charlie",
    keywords: ["deploy", "docker", "pipeline", "ci", "cron", "infra", "azure", "nginx"],
    checklist: [
      "Environment + secrets documented",
      "Rollback plan included",
      "Health checks defined",
    ],
  },
  {
    agentId: "scout",
    keywords: ["qa", "test", "playwright", "regression", "validation", "chromatic"],
    checklist: [
      "Acceptance criteria attached",
      "Test matrix included",
      "Pass/fail output format defined",
    ],
  },
  {
    agentId: "pixel",
    keywords: ["design", "ux", "wireframe", "visual", "accessibility", "interaction"],
    checklist: [
      "Target user + context defined",
      "States (empty/loading/error) required",
      "Design tokens referenced",
    ],
  },
  {
    agentId: "quill",
    keywords: ["docs", "readme", "runbook", "changelog", "release notes", "documentation"],
    checklist: [
      "Audience specified",
      "Examples included",
      "Owner + update cadence listed",
    ],
  },
  {
    agentId: "nexus",
    keywords: ["analytics", "metrics", "dashboard", "report", "kpi", "insights"],
    checklist: [
      "Metric definitions included",
      "Date window + filters specified",
      "Output format defined",
    ],
  },
  {
    agentId: "echo",
    keywords: ["french", "edito", "exercise", "lesson", "grammar", "language"],
    checklist: [
      "Level (A2/B1/etc) included",
      "Exercise types listed",
      "Validation source attached",
    ],
  },
];

export function recommendAgent(input: {
  title?: string;
  description?: string;
  tags?: string[];
}) {
  const hay = [input.title || "", input.description || "", ...(input.tags || [])]
    .join(" ")
    .toLowerCase();

  let best: { rule: RoutingRule; score: number; hits: string[] } | null = null;

  for (const rule of ROUTING_RULES) {
    const hits = rule.keywords.filter((kw) => hay.includes(kw));
    const score = hits.length;
    if (!best || score > best.score) {
      best = { rule, score, hits };
    }
  }

  if (!best || best.score === 0) {
    return {
      agentId: "project-astra" as AgentId,
      confidence: "low",
      reason: "No strong keyword match. Route to project-astra for triage and fan-out.",
      checklist: [
        "Define acceptance criteria",
        "Split into FE/BE/QA subtasks",
        "Assign specialist owners",
      ],
      handoff: ["project-astra -> specialist", "specialist -> scout", "scout -> quill/charlie"],
    };
  }

  return {
    agentId: best.rule.agentId,
    confidence: best.score >= 2 ? "high" : "medium",
    reason: `Matched keywords: ${best.hits.join(", ")}`,
    checklist: best.rule.checklist,
    handoff: [
      `${best.rule.agentId} -> scout (validation)`,
      "scout -> quill (PR notes)",
      "quill -> charlie (release checks)",
    ],
  };
}
