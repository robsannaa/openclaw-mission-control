import { NextRequest, NextResponse } from "next/server";
import { gatewayCall, runCli } from "@/lib/openclaw-cli";
import { readFile, stat } from "fs/promises";
import { extname, join } from "path";
import { getOpenClawHome } from "@/lib/paths";

/* ── Gather personal context for TTS test phrase generation ── */

async function gatherContext(): Promise<string> {
  const home = getOpenClawHome();
  const contextParts: string[] = [];

  // Try to read USER.md (human's profile)
  for (const wsDir of ["workspace", "workspace-gilfoyle"]) {
    try {
      const userMd = await readFile(join(home, wsDir, "USER.md"), "utf-8");
      if (userMd.trim()) {
        contextParts.push(`USER PROFILE:\n${userMd.trim()}`);
        break; // Only need one
      }
    } catch { /* file not found — skip */ }
  }

  // Try to read IDENTITY.md (agent's personality)
  try {
    const identityMd = await readFile(join(home, "workspace", "IDENTITY.md"), "utf-8");
    if (identityMd.trim()) {
      contextParts.push(`AGENT IDENTITY:\n${identityMd.trim()}`);
    }
  } catch { /* skip */ }

  // Try to read openclaw.json for agent names, model info
  try {
    const configRaw = await readFile(join(home, "openclaw.json"), "utf-8");
    const config = JSON.parse(configRaw);
    const agents = config?.agents?.list;
    if (Array.isArray(agents) && agents.length > 0) {
      const agentNames = agents.map((a: Record<string, unknown>) => a.name || a.id).join(", ");
      contextParts.push(`AGENTS: ${agentNames}`);
    }
    const model = config?.agents?.defaults?.model?.primary;
    if (model) contextParts.push(`MODEL: ${model}`);
  } catch { /* skip */ }

  // Current time for temporal awareness
  const now = new Date();
  const hour = now.getHours();
  const timeOfDay = hour < 12 ? "morning" : hour < 17 ? "afternoon" : "evening";
  const dayName = now.toLocaleDateString("en-US", { weekday: "long" });
  contextParts.push(`TIME: ${dayName} ${timeOfDay}, ${now.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}`);

  return contextParts.join("\n\n");
}

/**
 * Ask the OpenClaw agent to generate a personalized TTS test phrase.
 * Uses USER.md, IDENTITY.md, and config context to make it unique.
 * Falls back to personalized templates if the agent is unavailable.
 */
async function generateTestPhrase(): Promise<string> {
  const context = await gatherContext();

  // Try agent-generated phrase first
  try {
    const prompt = [
      "You are generating a single short TTS demo sentence (15-25 words).",
      "This sentence will be spoken out loud to test text-to-speech.",
      "Make it DEEPLY PERSONAL to the user and the moment. Reference their name,",
      "the time of day, their projects, or something specific from their profile.",
      "Be warm, witty, and natural — like a friend greeting them.",
      "Speak AS the AI assistant (use the agent's name if you know it).",
      "Do NOT add quotes, labels, or explanation. Just output the sentence.",
      "",
      "CONTEXT:",
      context,
    ].join("\n");

    const output = await runCli(
      ["agent", "--agent", "main", "--message", prompt],
      15000
    );
    const phrase = output.trim().replace(/^["']|["']$/g, ""); // strip wrapping quotes
    if (phrase && phrase.length > 10 && phrase.length < 300) {
      return phrase;
    }
  } catch {
    // Agent unavailable — fall through to personalized template
  }

  // Fallback: build a personalized phrase from gathered context
  // Extract user name from context
  const nameMatch = context.match(/\*\*(?:What to call them|Name):\*\*\s*(\w+)/i);
  const userName = nameMatch?.[1] || "boss";

  const agentMatch = context.match(/\*\*Name:\*\*\s*(\w+)/);
  const agentName = agentMatch?.[1] || "OpenClaw";

  const now = new Date();
  const hour = now.getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

  const phrases = [
    `${greeting}, ${userName}! It's ${agentName}. Voice systems are online — how do I sound?`,
    `Hey ${userName}, ${agentName} here. Just wanted to say — your AI setup is looking sharp today.`,
    `${userName}, it's your assistant ${agentName}. If you can hear this, we're officially talking.`,
    `${greeting}, ${userName}. ${agentName} speaking. Ready to help with whatever you need today.`,
    `This is ${agentName}, checking in with you, ${userName}. Voice is live and I'm here for you.`,
    `Hey ${userName}! ${agentName} just found its voice. Pretty cool, right?`,
    `${greeting}, ${userName}. It's ${agentName} on the mic. Let's get things done today.`,
    `${userName}, your AI assistant ${agentName} is now speaking. How's that for a personal touch?`,
  ];
  return phrases[Math.floor(Math.random() * phrases.length)];
}

const MIME_TYPES: Record<string, string> = {
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
  ".opus": "audio/ogg",
  ".wav": "audio/wav",
  ".webm": "audio/webm",
  ".m4a": "audio/mp4",
  ".aac": "audio/aac",
};

/**
 * GET /api/audio - Returns TTS status, providers, and config.
 *
 * Query: scope=status (default) | providers | stream
 *        path=<filepath>  (required for scope=stream)
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const scope = searchParams.get("scope") || "status";

  try {
    // Stream an audio file for playback
    if (scope === "stream") {
      const filePath = searchParams.get("path") || "";
      if (!filePath) {
        return NextResponse.json({ error: "path required" }, { status: 400 });
      }
      // Security: only allow temp directory audio files
      if (!filePath.startsWith("/tmp/") && !filePath.includes("/T/tts-") && !filePath.includes("/tmp/")) {
        return NextResponse.json({ error: "Path not allowed" }, { status: 403 });
      }
      try {
        const info = await stat(filePath);
        const ext = extname(filePath).toLowerCase();
        const contentType = MIME_TYPES[ext] || "audio/mpeg";
        const buffer = await readFile(filePath);
        return new NextResponse(buffer, {
          status: 200,
          headers: {
            "Content-Type": contentType,
            "Content-Length": info.size.toString(),
            "Cache-Control": "no-cache",
          },
        });
      } catch {
        return NextResponse.json({ error: "File not found" }, { status: 404 });
      }
    }

    if (scope === "providers") {
      const providers = await gatewayCall<Record<string, unknown>>(
        "tts.providers",
        undefined,
        10000
      );
      return NextResponse.json(providers);
    }

    // Default: full status + providers + config
    const [status, providers, configData] = await Promise.all([
      gatewayCall<Record<string, unknown>>("tts.status", undefined, 10000),
      gatewayCall<Record<string, unknown>>("tts.providers", undefined, 10000),
      gatewayCall<Record<string, unknown>>("config.get", undefined, 10000),
    ]);

    // Extract relevant config sections
    const resolved = (configData.resolved || {}) as Record<string, unknown>;
    const parsed = (configData.parsed || {}) as Record<string, unknown>;

    const resolvedMessages = (resolved.messages || {}) as Record<string, unknown>;
    const resolvedTts = (resolvedMessages.tts || {}) as Record<string, unknown>;
    const resolvedTalk = (resolved.talk || {}) as Record<string, unknown>;
    const resolvedTools = (resolved.tools || {}) as Record<string, unknown>;
    const resolvedMedia = (resolvedTools.media || {}) as Record<string, unknown>;
    const resolvedAudio = (resolvedMedia.audio || {}) as Record<string, unknown>;

    const parsedMessages = (parsed.messages || {}) as Record<string, unknown>;
    const parsedTts = parsedMessages.tts as Record<string, unknown> | undefined;
    const parsedTalk = parsed.talk as Record<string, unknown> | undefined;
    const parsedMedia = ((parsed.tools || {}) as Record<string, unknown>).media as
      | Record<string, unknown>
      | undefined;

    // Read TTS user preferences if available
    let prefs: Record<string, unknown> | null = null;
    const prefsPath = (status.prefsPath as string) || "";
    if (prefsPath) {
      try {
        const raw = await readFile(prefsPath, "utf-8");
        prefs = JSON.parse(raw);
      } catch {
        // prefs file may not exist
      }
    }

    return NextResponse.json({
      status,
      providers,
      config: {
        tts: {
          resolved: resolvedTts,
          parsed: parsedTts || null,
        },
        talk: {
          resolved: resolvedTalk,
          parsed: parsedTalk || null,
        },
        audioUnderstanding: {
          resolved: resolvedAudio,
          parsed: parsedMedia || null,
        },
      },
      prefs,
      configHash: configData.hash || null,
    });
  } catch (err) {
    console.error("Audio API GET error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

/**
 * POST /api/audio - Audio/TTS management actions.
 *
 * Body:
 *   { action: "enable" }
 *   { action: "disable" }
 *   { action: "set-provider", provider: "openai" | "elevenlabs" | "edge" }
 *   { action: "test", text: "Hello world" }
 *   { action: "update-config", section: "tts" | "talk", config: { ... } }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const action = body.action as string;

    switch (action) {
      case "set-auto-mode": {
        // Set auto-TTS mode via config patch (most reliable method)
        const mode = body.mode as string;
        if (!["off", "always", "inbound", "tagged"].includes(mode)) {
          return NextResponse.json(
            { error: `Invalid mode: ${mode}. Use off, always, inbound, or tagged.` },
            { status: 400 }
          );
        }
        try {
          const configData = await gatewayCall<Record<string, unknown>>(
            "config.get", undefined, 10000
          );
          const hash = configData.hash as string;
          await gatewayCall(
            "config.patch",
            { raw: JSON.stringify({ messages: { tts: { auto: mode } } }), baseHash: hash },
            15000
          );
          return NextResponse.json({ ok: true, action, mode });
        } catch (_err) {
          return NextResponse.json(
            { ok: false, error: "Could not update auto-TTS mode. Is the gateway running?" },
            { status: 502 }
          );
        }
      }

      case "enable":
      case "disable": {
        // Try RPC first, fall back to config patch
        try {
          const result = await gatewayCall<Record<string, unknown>>(
            action === "enable" ? "tts.enable" : "tts.disable",
            undefined,
            8000
          );
          return NextResponse.json({ ok: true, action, ...result });
        } catch {
          // Fallback: patch config directly
          try {
            const configData = await gatewayCall<Record<string, unknown>>(
              "config.get", undefined, 10000
            );
            const hash = configData.hash as string;
            const auto = action === "enable" ? "always" : "off";
            await gatewayCall(
              "config.patch",
              { raw: JSON.stringify({ messages: { tts: { auto } } }), baseHash: hash },
              15000
            );
            return NextResponse.json({ ok: true, action, fallback: true });
          } catch {
            return NextResponse.json(
              { ok: false, error: "Could not reach the gateway. Make sure it is running." },
              { status: 502 }
            );
          }
        }
      }

      case "set-provider": {
        const provider = body.provider as string;
        if (!provider) {
          return NextResponse.json(
            { error: "provider is required" },
            { status: 400 }
          );
        }
        try {
          const result = await gatewayCall<Record<string, unknown>>(
            "tts.setProvider",
            { provider },
            10000
          );
          return NextResponse.json({ ok: true, action, provider, ...result });
        } catch {
          // Fallback: patch config
          try {
            const configData = await gatewayCall<Record<string, unknown>>(
              "config.get", undefined, 10000
            );
            const hash = configData.hash as string;
            await gatewayCall(
              "config.patch",
              { raw: JSON.stringify({ messages: { tts: { provider } } }), baseHash: hash },
              15000
            );
            return NextResponse.json({ ok: true, action, provider, fallback: true });
          } catch {
            return NextResponse.json(
              { ok: false, error: "Could not set provider. Is the gateway running?" },
              { status: 502 }
            );
          }
        }
      }

      case "generate-phrase": {
        // Just generate a personalized phrase (no TTS conversion)
        const phrase = await generateTestPhrase();
        return NextResponse.json({ ok: true, phrase });
      }

      case "test": {
        // Use explicit text if provided, otherwise ask the agent for a unique phrase
        const text = (body.text as string) || await generateTestPhrase();
        const params: Record<string, unknown> = { text };
        if (body.provider) params.provider = body.provider;
        if (body.voice) params.voice = body.voice;
        if (body.model) params.model = body.model;

        try {
          const result = await gatewayCall<Record<string, unknown>>(
            "tts.convert",
            params,
            30000
          );
          return NextResponse.json({ ok: true, action, text, ...result });
        } catch {
          return NextResponse.json(
            { ok: false, error: "TTS generation failed. Check that the gateway is running and the provider has a valid API key." },
            { status: 502 }
          );
        }
      }

      case "update-config": {
        const section = body.section as string;
        const config = body.config as Record<string, unknown>;
        if (!section || !config) {
          return NextResponse.json(
            { error: "section and config required" },
            { status: 400 }
          );
        }

        try {
          const configData = await gatewayCall<Record<string, unknown>>(
            "config.get", undefined, 10000
          );
          const hash = configData.hash as string;

          let patchRaw: string;
          if (section === "tts") {
            patchRaw = JSON.stringify({ messages: { tts: config } });
          } else if (section === "talk") {
            patchRaw = JSON.stringify({ talk: config });
          } else if (section === "audio") {
            patchRaw = JSON.stringify({ tools: { media: { audio: config } } });
          } else {
            return NextResponse.json(
              { error: `Unknown section: ${section}` },
              { status: 400 }
            );
          }

          await gatewayCall(
            "config.patch",
            { raw: patchRaw, baseHash: hash },
            15000
          );
          return NextResponse.json({ ok: true, action, section });
        } catch {
          return NextResponse.json(
            { ok: false, error: `Could not update ${section} config. Is the gateway running?` },
            { status: 502 }
          );
        }
      }

      default:
        return NextResponse.json(
          { error: `Unknown action: ${action}` },
          { status: 400 }
        );
    }
  } catch (err) {
    console.error("Audio API POST error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
