import { NextResponse } from "next/server";
import { readdir } from "fs/promises";
import { getGogKeyringDir } from "@/lib/paths";

export const dynamic = "force-dynamic";

/**
 * GET /api/calendar/accounts
 * List gog accounts by reading keyring filenames (token:...:email).
 * No passphrase needed; we only list filenames, not token contents.
 */
export async function GET() {
  try {
    const keyringDir = getGogKeyringDir();
    const files = await readdir(keyringDir);
    const emails = new Set<string>();
    for (const name of files) {
      if (!name.startsWith("token:")) continue;
      const parts = name.split(":");
      const email = parts.at(-1)?.trim();
      if (email && email.includes("@")) emails.add(email);
    }
    return NextResponse.json({
      accounts: Array.from(emails).sort(),
    });
  } catch {
    return NextResponse.json({ accounts: [] });
  }
}
