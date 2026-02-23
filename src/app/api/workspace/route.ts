import { NextResponse } from 'next/server';
import { getWorkspaceSnapshot } from "@/lib/workspace-snapshot";

export async function GET() {
  try {
    const snapshot = await getWorkspaceSnapshot();
    return NextResponse.json(snapshot);
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
