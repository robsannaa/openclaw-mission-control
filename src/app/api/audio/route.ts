import { NextRequest, NextResponse } from "next/server";
import { gatewayCall } from "@/lib/openclaw-cli";
import { readFile, stat } from "fs/promises";
import { extname } from "path";

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
      case "enable": {
        const result = await gatewayCall<Record<string, unknown>>(
          "tts.enable",
          undefined,
          10000
        );
        return NextResponse.json({ ok: true, action, ...result });
      }

      case "disable": {
        const result = await gatewayCall<Record<string, unknown>>(
          "tts.disable",
          undefined,
          10000
        );
        return NextResponse.json({ ok: true, action, ...result });
      }

      case "set-provider": {
        const provider = body.provider as string;
        if (!provider) {
          return NextResponse.json(
            { error: "provider is required" },
            { status: 400 }
          );
        }
        const result = await gatewayCall<Record<string, unknown>>(
          "tts.setProvider",
          { provider },
          10000
        );
        return NextResponse.json({ ok: true, action, provider, ...result });
      }

      case "test": {
        const text = (body.text as string) || "Hello! This is a test of the text to speech system.";
        const params: Record<string, unknown> = { text };
        if (body.provider) params.provider = body.provider;
        if (body.voice) params.voice = body.voice;
        if (body.model) params.model = body.model;

        const result = await gatewayCall<Record<string, unknown>>(
          "tts.convert",
          params,
          30000
        );
        return NextResponse.json({ ok: true, action, ...result });
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

        // Get current config hash
        const configData = await gatewayCall<Record<string, unknown>>(
          "config.get",
          undefined,
          10000
        );
        const hash = configData.hash as string;

        // Build the patch
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
