import { NextResponse } from "next/server";
import { fetchOpenRouterBilling } from "@/lib/openrouter-usage";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const result = await fetchOpenRouterBilling();
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { available: false, reason: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
