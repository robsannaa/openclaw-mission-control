import { NextRequest, NextResponse } from "next/server";
import { runCliJson, runCliCaptureBoth } from "@/lib/openclaw-cli";

export const dynamic = "force-dynamic";

/* ── Types ───────────────────────────────────────── */

type AuditFinding = {
  code: string;
  severity: "warn" | "info" | "error";
  file: string;
  path: string;
  message: string;
  provider?: string;
  detail?: string;
};

type AuditResponse = {
  version: number;
  status: string;
  filesScanned: string[];
  summary: {
    plaintextCount: number;
    unresolvedRefCount: number;
    shadowedRefCount: number;
    legacyResidueCount: number;
  };
  findings: AuditFinding[];
};

/* ── GET: run secrets audit ─────────────────────── */

export async function GET() {
  try {
    const audit = await runCliJson<AuditResponse>(
      ["secrets", "audit"],
      30000
    );
    return NextResponse.json(audit);
  } catch (err) {
    return NextResponse.json(
      { error: String(err) },
      { status: 500 }
    );
  }
}

/* ── POST: configure, apply, reload ─────────────── */

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const action = String(body.action || "");

    switch (action) {
      case "configure": {
        // Run non-interactive configure with --providers-only or --skip-provider-setup
        // and --json to get the plan
        const args = ["secrets", "configure", "--json", "--yes"];
        if (body.providersOnly) args.push("--providers-only");
        if (body.skipProviderSetup) args.push("--skip-provider-setup");
        if (body.apply) args.push("--apply");

        const result = await runCliCaptureBoth(args, 60000);
        let parsed: Record<string, unknown> = {};
        try {
          // Try to parse JSON from stdout
          const jsonMatch = result.stdout.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            parsed = JSON.parse(jsonMatch[0]);
          }
        } catch {
          parsed = { raw: result.stdout };
        }

        return NextResponse.json({
          ok: result.code === 0,
          ...parsed,
          stderr: result.stderr || undefined,
          code: result.code,
        });
      }

      case "apply": {
        // Apply a previously generated plan
        const args = ["secrets", "apply", "--json"];
        if (body.dryRun) args.push("--dry-run");
        if (body.planPath) args.push("--from", body.planPath);

        const result = await runCliCaptureBoth(args, 60000);
        let parsed: Record<string, unknown> = {};
        try {
          const jsonMatch = result.stdout.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            parsed = JSON.parse(jsonMatch[0]);
          }
        } catch {
          parsed = { raw: result.stdout };
        }

        return NextResponse.json({
          ok: result.code === 0,
          ...parsed,
          stderr: result.stderr || undefined,
          code: result.code,
        });
      }

      case "reload": {
        const args = ["secrets", "reload", "--json"];
        const result = await runCliCaptureBoth(args, 30000);
        let parsed: Record<string, unknown> = {};
        try {
          const jsonMatch = result.stdout.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            parsed = JSON.parse(jsonMatch[0]);
          }
        } catch {
          parsed = { raw: result.stdout };
        }

        return NextResponse.json({
          ok: result.code === 0,
          ...parsed,
          stderr: result.stderr || undefined,
          code: result.code,
        });
      }

      case "audit": {
        // Allow POST-based audit too for consistency
        const audit = await runCliJson<AuditResponse>(
          ["secrets", "audit"],
          30000
        );
        return NextResponse.json(audit);
      }

      default:
        return NextResponse.json(
          { error: `Unknown action: ${action}` },
          { status: 400 }
        );
    }
  } catch (err) {
    return NextResponse.json(
      { error: String(err) },
      { status: 500 }
    );
  }
}
