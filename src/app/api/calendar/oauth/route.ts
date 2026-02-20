import { NextRequest, NextResponse } from "next/server";
import { getAuthUrl, getRedirectUri } from "@/lib/google-calendar";

export const dynamic = "force-dynamic";

/** GET /api/calendar/oauth — redirect to Google OAuth. */
export async function GET(request: NextRequest) {
  const origin = request.headers.get("origin") || request.nextUrl.origin;
  const redirectUri = getRedirectUri(origin);
  const authUrl = getAuthUrl(redirectUri);
  if (!authUrl) {
    return NextResponse.json(
      { error: "Google Calendar OAuth not configured. Set GOOGLE_CALENDAR_CLIENT_ID and GOOGLE_CALENDAR_CLIENT_SECRET." },
      { status: 503 }
    );
  }
  return NextResponse.redirect(authUrl);
}
