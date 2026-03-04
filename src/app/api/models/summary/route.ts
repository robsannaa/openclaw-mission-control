import { NextResponse } from "next/server";
import { buildModelsSummary } from "@/lib/models-summary";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const NO_STORE_HEADERS = { "Cache-Control": "no-store" } as const;

export async function GET() {
  try {
    const payload = await buildModelsSummary();
    return NextResponse.json(payload, {
      headers: NO_STORE_HEADERS,
    });
  } catch (error) {
    return NextResponse.json(
      { error: String(error || "Failed to build models summary") },
      {
        status: 500,
        headers: NO_STORE_HEADERS,
      }
    );
  }
}
