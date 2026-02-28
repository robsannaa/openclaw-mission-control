import { NextRequest, NextResponse } from "next/server";
import { listDoctorRuns, deleteDoctorRun } from "@/lib/doctor-history";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const limit = Math.min(Math.max(parseInt(url.searchParams.get("limit") || "20", 10) || 20, 1), 50);
  const offset = Math.max(parseInt(url.searchParams.get("offset") || "0", 10) || 0, 0);

  const result = await listDoctorRuns(limit, offset);
  return NextResponse.json(result);
}

export async function DELETE(request: NextRequest) {
  const url = new URL(request.url);
  const id = url.searchParams.get("id");

  if (!id) {
    return NextResponse.json({ error: "id parameter required" }, { status: 400 });
  }

  const deleted = await deleteDoctorRun(id);
  if (!deleted) {
    return NextResponse.json({ error: "Run not found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
