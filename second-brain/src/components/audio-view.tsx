"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import {
  Volume2,
  VolumeX,
  Play,
  Pause,
  Mic,
  Radio,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  Check,
  AlertTriangle,
  Headphones,
  Settings2,
  Speaker,
  Waves,
  Zap,
  Globe,
  Loader2,
  X,
  Ear,
} from "lucide-react";
import { cn } from "@/lib/utils";

/* ── Types ────────────────────────────────────────── */

type TtsStatus = {
  enabled: boolean;
  auto: string;
  provider: string;
  fallbackProvider?: string;
  fallbackProviders?: string[];
  prefsPath?: string;
  hasOpenAIKey?: boolean;
  hasElevenLabsKey?: boolean;
  edgeEnabled?: boolean;
};

type TtsProvider = {
  id: string;
  name: string;
  configured: boolean;
  models: string[];
  voices?: string[];
};

type TtsProvidersData = {
  providers: TtsProvider[];
  active: string;
};

type TalkConfig = {
  voiceId?: string;
  voiceAliases?: Record<string, string>;
  modelId?: string;
  outputFormat?: string;
  apiKey?: string;
  interruptOnSpeech?: boolean;
};

type AudioConfig = {
  enabled?: boolean;
  maxBytes?: number;
  scope?: Record<string, unknown>;
  models?: AudioModel[];
};

type AudioModel = {
  type?: string;
  provider?: string;
  model?: string;
  command?: string;
  args?: string[];
  timeoutSeconds?: number;
  capabilities?: string[];
};

type TtsPrefs = {
  enabled?: boolean;
  provider?: string;
  maxLength?: number;
  summarize?: boolean;
};

type Toast = { message: string; type: "success" | "error" };

type AudioFullState = {
  status: TtsStatus;
  providers: TtsProvidersData;
  config: {
    tts: { resolved: Record<string, unknown>; parsed: Record<string, unknown> | null };
    talk: { resolved: TalkConfig; parsed: TalkConfig | null };
    audioUnderstanding: {
      resolved: AudioConfig;
      parsed: Record<string, unknown> | null;
    };
  };
  prefs: TtsPrefs | null;
};

/* ── Helpers ──────────────────────────────────────── */

const PROVIDER_ICONS: Record<string, string> = {
  openai: "🤖",
  elevenlabs: "🔊",
  edge: "🌐",
};

const PROVIDER_COLORS: Record<string, string> = {
  openai: "bg-emerald-500/15 text-emerald-400 border-emerald-500/20",
  elevenlabs: "bg-violet-500/15 text-violet-400 border-violet-500/20",
  edge: "bg-sky-500/15 text-sky-400 border-sky-500/20",
};

const AUTO_MODES = [
  { value: "off", label: "Off", desc: "No automatic TTS" },
  { value: "always", label: "Always", desc: "All replies spoken" },
  { value: "inbound", label: "Inbound", desc: "Voice-reply to voice messages" },
  { value: "tagged", label: "Tagged", desc: "Only /tts tagged messages" },
];

function formatBytes(b: number): string {
  if (b >= 1048576) return `${(b / 1048576).toFixed(0)} MB`;
  if (b >= 1024) return `${(b / 1024).toFixed(0)} KB`;
  return `${b} B`;
}

/* ── Toast Component ─────────────────────────────── */

function ToastBar({ toast, onDone }: { toast: Toast; onDone: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDone, 3500);
    return () => clearTimeout(t);
  }, [onDone]);

  return (
    <div
      className={cn(
        "fixed bottom-6 left-1/2 z-[60] -translate-x-1/2 rounded-lg border px-4 py-2.5 text-[13px] font-medium shadow-xl backdrop-blur-sm",
        toast.type === "success"
          ? "border-emerald-500/30 bg-emerald-950/80 text-emerald-300"
          : "border-red-500/30 bg-red-950/80 text-red-300"
      )}
    >
      <div className="flex items-center gap-2">
        {toast.type === "success" ? (
          <Check className="h-4 w-4" />
        ) : (
          <AlertTriangle className="h-4 w-4" />
        )}
        {toast.message}
      </div>
    </div>
  );
}

/* ── Provider Card ───────────────────────────────── */

function ProviderCard({
  provider,
  isActive,
  onSelect,
  loading,
  onTest,
}: {
  provider: TtsProvider;
  isActive: boolean;
  onSelect: () => void;
  loading: boolean;
  onTest: (provider: string, voice?: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [selectedVoice, setSelectedVoice] = useState<string | null>(null);
  const color = PROVIDER_COLORS[provider.id] || "bg-zinc-500/15 text-zinc-400 border-zinc-500/20";
  const icon = PROVIDER_ICONS[provider.id] || "🔈";

  return (
    <div
      className={cn(
        "rounded-xl border transition-all",
        isActive
          ? "border-violet-500/30 bg-violet-500/[0.06]"
          : "border-white/[0.06] bg-white/[0.02] hover:border-white/[0.12]"
      )}
    >
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3.5">
        <span className="text-xl">{icon}</span>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <span className="text-[14px] font-semibold text-zinc-200">
              {provider.name}
            </span>
            {isActive && (
              <span className="rounded-full bg-violet-500/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-violet-300">
                Active
              </span>
            )}
            {!provider.configured && (
              <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-amber-300">
                No API Key
              </span>
            )}
          </div>
          <div className="mt-0.5 flex items-center gap-3 text-[11px] text-zinc-500">
            {provider.models.length > 0 && (
              <span>
                {provider.models.length} model{provider.models.length !== 1 ? "s" : ""}
              </span>
            )}
            {provider.voices && (
              <span>
                {provider.voices.length} voice{provider.voices.length !== 1 ? "s" : ""}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {!isActive && provider.configured && (
            <button
              onClick={onSelect}
              disabled={loading}
              className="rounded-lg bg-white/[0.06] px-3 py-1.5 text-[12px] font-medium text-zinc-300 transition-colors hover:bg-white/[0.1] hover:text-zinc-100 disabled:opacity-50"
            >
              {loading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                "Set Active"
              )}
            </button>
          )}
          <button
            onClick={() => setExpanded(!expanded)}
            className="rounded-lg p-1.5 text-zinc-500 transition-colors hover:bg-white/[0.06] hover:text-zinc-300"
          >
            {expanded ? (
              <ChevronUp className="h-4 w-4" />
            ) : (
              <ChevronDown className="h-4 w-4" />
            )}
          </button>
        </div>
      </div>

      {/* Expanded: Models & Voices */}
      {expanded && (
        <div className="border-t border-white/[0.04] px-4 py-3 space-y-3">
          {/* Models */}
          {provider.models.length > 0 && (
            <div>
              <p className="text-[11px] font-medium uppercase tracking-wider text-zinc-500 mb-1.5">
                Models
              </p>
              <div className="flex flex-wrap gap-1.5">
                {provider.models.map((m) => (
                  <span
                    key={m}
                    className={cn(
                      "rounded-md border px-2 py-0.5 text-[11px]",
                      color
                    )}
                  >
                    {m}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Voices */}
          {provider.voices && provider.voices.length > 0 && (
            <div>
              <p className="text-[11px] font-medium uppercase tracking-wider text-zinc-500 mb-1.5">
                Voices
              </p>
              <div className="flex flex-wrap gap-1.5">
                {provider.voices.map((v) => (
                  <button
                    key={v}
                    onClick={() => setSelectedVoice(selectedVoice === v ? null : v)}
                    className={cn(
                      "rounded-md border px-2 py-1 text-[11px] transition-all",
                      selectedVoice === v
                        ? "border-violet-500/40 bg-violet-500/15 text-violet-300"
                        : "border-white/[0.08] bg-white/[0.03] text-zinc-400 hover:border-white/[0.15] hover:text-zinc-300"
                    )}
                  >
                    {v}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Test button */}
          {provider.configured && (
            <div className="pt-1">
              <button
                onClick={() => onTest(provider.id, selectedVoice || undefined)}
                className="flex items-center gap-2 rounded-lg bg-violet-600/20 px-3 py-2 text-[12px] font-medium text-violet-300 transition-colors hover:bg-violet-600/30"
              >
                <Play className="h-3.5 w-3.5" />
                Test {provider.name}
                {selectedVoice && ` · ${selectedVoice}`}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ── Audio Player ────────────────────────────────── */

function AudioPlayer({
  result,
  autoPlay = true,
}: {
  result: { provider: string; format: string; path: string; voiceCompatible: boolean };
  autoPlay?: boolean;
}) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [ready, setReady] = useState(false);

  const audioUrl = `/api/audio?scope=stream&path=${encodeURIComponent(result.path)}`;

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const onCanPlay = () => {
      setReady(true);
      // Auto-play when audio is ready
      if (autoPlay) {
        audio.play().then(() => setPlaying(true)).catch(() => {});
      }
    };
    const onTimeUpdate = () => {
      if (audio.duration) setProgress(audio.currentTime / audio.duration);
    };
    const onDurationChange = () => setDuration(audio.duration || 0);
    const onEnded = () => {
      setPlaying(false);
      setProgress(1);
    };
    const onError = () => setReady(false);

    audio.addEventListener("canplay", onCanPlay);
    audio.addEventListener("timeupdate", onTimeUpdate);
    audio.addEventListener("durationchange", onDurationChange);
    audio.addEventListener("ended", onEnded);
    audio.addEventListener("error", onError);

    return () => {
      audio.removeEventListener("canplay", onCanPlay);
      audio.removeEventListener("timeupdate", onTimeUpdate);
      audio.removeEventListener("durationchange", onDurationChange);
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("error", onError);
      // Stop audio when unmounting
      audio.pause();
    };
  }, [autoPlay]);

  const togglePlay = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (playing) {
      audio.pause();
      setPlaying(false);
    } else {
      audio.play().catch(console.error);
      setPlaying(true);
    }
  };

  const seekTo = (e: React.MouseEvent<HTMLDivElement>) => {
    const audio = audioRef.current;
    if (!audio || !audio.duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    audio.currentTime = pct * audio.duration;
    setProgress(pct);
  };

  const formatTime = (s: number) => {
    if (!s || !isFinite(s)) return "0:00";
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, "0")}`;
  };

  return (
    <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/[0.04] p-4 space-y-3">
      <audio ref={audioRef} src={audioUrl} preload="auto" />

      <div className="flex items-center gap-2 text-[13px] font-medium text-emerald-300">
        <Check className="h-4 w-4" />
        Audio Generated Successfully
      </div>

      {/* Player controls */}
      <div className="flex items-center gap-3 rounded-lg border border-emerald-500/15 bg-black/30 px-3 py-3">
        <button
          onClick={togglePlay}
          className={cn(
            "flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition-colors",
            playing
              ? "bg-emerald-500 text-black hover:bg-emerald-400"
              : "bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30"
          )}
        >
          {playing ? (
            <Pause className="h-4 w-4" />
          ) : (
            <Play className="h-4 w-4 ml-0.5" />
          )}
        </button>

        <div className="flex-1 space-y-1">
          {/* Progress bar */}
          <div
            className="group relative h-2 cursor-pointer rounded-full bg-white/[0.08]"
            onClick={seekTo}
          >
            <div
              className="absolute inset-y-0 left-0 rounded-full bg-emerald-400 transition-all"
              style={{ width: `${progress * 100}%` }}
            />
            <div
              className="absolute top-1/2 -translate-y-1/2 h-3 w-3 rounded-full bg-emerald-300 opacity-0 group-hover:opacity-100 transition-opacity shadow-md"
              style={{ left: `calc(${progress * 100}% - 6px)` }}
            />
          </div>

          {/* Time */}
          <div className="flex items-center justify-between text-[10px] text-zinc-500">
            <span>{formatTime(progress * duration)}</span>
            <span>{formatTime(duration)}</span>
          </div>
        </div>
      </div>

      {/* Metadata */}
      <div className="grid grid-cols-3 gap-3">
        <ConfigField label="Provider" value={result.provider} />
        <ConfigField label="Format" value={result.format} />
        <ConfigField
          label="Voice Compatible"
          value={result.voiceCompatible ? "Yes" : "No"}
        />
      </div>
      <div className="flex items-center gap-2 text-[11px] text-zinc-500">
        <span>Saved to:</span>
        <code className="rounded bg-black/30 px-1.5 py-0.5 text-[10px] text-zinc-400 truncate">
          {result.path}
        </code>
      </div>
    </div>
  );
}

/* ── TTS Test Panel ─────────────────────────────── */

function TtsTestPanel({ onTest, testing }: { onTest: (text: string, provider?: string, voice?: string) => void; testing: boolean }) {
  const [text, setText] = useState("Hello! This is a test of the text to speech system. How does this sound?");

  const handleTest = () => {
    onTest(text);
  };

  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4 space-y-3">
      <div className="flex items-center gap-2 text-[13px] font-semibold text-zinc-200">
        <Headphones className="h-4 w-4 text-violet-400" />
        Generate Sample Voice
      </div>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={3}
        className="w-full rounded-lg border border-white/[0.08] bg-black/30 px-3 py-2 text-[13px] text-zinc-200 placeholder-zinc-600 outline-none focus:border-violet-500/30 resize-none"
        placeholder="Enter text to convert to speech..."
      />
      <button
        onClick={handleTest}
        disabled={testing || !text.trim()}
        className="flex items-center gap-2 rounded-lg bg-violet-600 px-4 py-2 text-[13px] font-medium text-white transition-colors hover:bg-violet-500 disabled:opacity-50"
      >
        {testing ? (
          <>
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Generating...
          </>
        ) : (
          <>
            <Volume2 className="h-3.5 w-3.5" />
            Generate & Play
          </>
        )}
      </button>
    </div>
  );
}

/* ── Talk Mode Section ───────────────────────────── */

function TalkModeSection({ config }: { config: TalkConfig }) {
  const hasConfig = config && Object.keys(config).length > 0;

  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4 space-y-3">
      <div className="flex items-center gap-2 text-[13px] font-semibold text-zinc-200">
        <Mic className="h-4 w-4 text-emerald-400" />
        Talk Mode
        <span className="text-[11px] text-zinc-500 font-normal">(macOS / iOS / Android)</span>
      </div>
      <p className="text-[12px] text-zinc-500">
        Continuous voice conversation loop: Listen → Transcribe → Respond → Speak.
        Uses ElevenLabs for real-time streaming playback.
      </p>

      {hasConfig ? (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-3">
            <ConfigField label="Voice ID" value={config.voiceId || "auto-detect"} />
            <ConfigField label="Model" value={config.modelId || "eleven_v3"} />
            <ConfigField label="Output Format" value={config.outputFormat || "pcm_44100 (macOS)"} />
            <ConfigField label="Interrupt on Speech" value={config.interruptOnSpeech !== false ? "Enabled" : "Disabled"} />
          </div>
          {config.voiceAliases && Object.keys(config.voiceAliases).length > 0 && (
            <div className="mt-2">
              <p className="text-[11px] font-medium uppercase tracking-wider text-zinc-500 mb-1.5">
                Voice Aliases
              </p>
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(config.voiceAliases).map(([alias, id]) => (
                  <span
                    key={alias}
                    className="rounded-md border border-emerald-500/20 bg-emerald-500/10 px-2 py-0.5 text-[11px] text-emerald-400"
                    title={id}
                  >
                    {alias}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-white/[0.08] bg-black/20 px-4 py-6 text-center">
          <Mic className="mx-auto h-8 w-8 text-zinc-700 mb-2" />
          <p className="text-[12px] text-zinc-500">
            Talk Mode is not configured yet.
          </p>
          <p className="text-[11px] text-zinc-600 mt-1">
            Add a <code className="rounded bg-white/[0.06] px-1 py-0.5 text-[10px]">talk</code> section to openclaw.json to enable.
          </p>
        </div>
      )}

      {/* Usage info */}
      <div className="rounded-lg border border-white/[0.04] bg-black/20 px-3 py-2.5">
        <p className="text-[11px] font-medium text-zinc-400 mb-1">How it works</p>
        <div className="grid grid-cols-4 gap-2">
          {[
            { icon: "🎤", label: "Listen", desc: "Detects speech" },
            { icon: "📝", label: "Transcribe", desc: "Speech → text" },
            { icon: "🧠", label: "Think", desc: "Agent responds" },
            { icon: "🔊", label: "Speak", desc: "ElevenLabs TTS" },
          ].map((step) => (
            <div key={step.label} className="text-center">
              <span className="text-lg">{step.icon}</span>
              <p className="text-[11px] font-medium text-zinc-300 mt-0.5">{step.label}</p>
              <p className="text-[10px] text-zinc-600">{step.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ── Audio Understanding Section ─────────────────── */

function AudioUnderstandingSection({ config }: { config: AudioConfig }) {
  const isEnabled = config.enabled !== false;
  const models = config.models || [];

  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-[13px] font-semibold text-zinc-200">
          <Ear className="h-4 w-4 text-sky-400" />
          Audio Understanding
          <span className="text-[11px] text-zinc-500 font-normal">(Inbound Transcription)</span>
        </div>
        <span
          className={cn(
            "rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider",
            isEnabled
              ? "bg-emerald-500/20 text-emerald-400"
              : "bg-zinc-500/20 text-zinc-500"
          )}
        >
          {isEnabled ? "Active" : "Disabled"}
        </span>
      </div>

      <p className="text-[12px] text-zinc-500">
        Transcribes incoming voice messages and audio files using configured providers.
        Auto-detects available services when no explicit configuration is set.
      </p>

      {models.length > 0 ? (
        <div>
          <p className="text-[11px] font-medium uppercase tracking-wider text-zinc-500 mb-1.5">
            Transcription Pipeline
          </p>
          <div className="space-y-1.5">
            {models.map((m, i) => (
              <div
                key={i}
                className="flex items-center gap-3 rounded-lg border border-white/[0.06] bg-black/20 px-3 py-2"
              >
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-sky-500/15 text-[11px] font-bold text-sky-400">
                  {i + 1}
                </span>
                <div className="flex-1">
                  {m.type === "cli" ? (
                    <span className="text-[12px] text-zinc-300">
                      CLI: <code className="rounded bg-white/[0.06] px-1 text-[11px]">{m.command}</code>
                    </span>
                  ) : (
                    <span className="text-[12px] text-zinc-300">
                      {m.provider || "auto"}/{m.model || "default"}
                    </span>
                  )}
                  {m.timeoutSeconds && (
                    <span className="ml-2 text-[10px] text-zinc-600">
                      timeout: {m.timeoutSeconds}s
                    </span>
                  )}
                </div>
                {m.capabilities && (
                  <div className="flex gap-1">
                    {m.capabilities.map((c) => (
                      <span
                        key={c}
                        className="rounded-md border border-sky-500/20 bg-sky-500/10 px-1.5 py-0.5 text-[9px] text-sky-400"
                      >
                        {c}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-sky-500/10 bg-sky-500/[0.03] px-4 py-3">
          <div className="flex items-start gap-2">
            <Zap className="h-4 w-4 text-sky-400 mt-0.5 shrink-0" />
            <div>
              <p className="text-[12px] font-medium text-sky-300">Auto-Detection Active</p>
              <p className="text-[11px] text-zinc-500 mt-0.5">
                OpenClaw auto-detects transcription providers in order: local CLIs (sherpa-onnx, whisper-cli, whisper)
                → Gemini CLI → Provider APIs (OpenAI → Groq → Deepgram → Google).
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Max bytes */}
      {config.maxBytes && (
        <ConfigField label="Max Audio Size" value={formatBytes(config.maxBytes)} />
      )}

      {/* Scope rules */}
      {config.scope && (
        <div className="mt-1">
          <p className="text-[11px] font-medium uppercase tracking-wider text-zinc-500 mb-1">
            Scope Rules
          </p>
          <pre className="rounded-lg bg-black/30 p-2 text-[11px] text-zinc-400 overflow-auto">
            {JSON.stringify(config.scope, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}

/* ── Config Field ────────────────────────────────── */

function ConfigField({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-white/[0.04] bg-black/20 px-3 py-2">
      <p className="text-[10px] font-medium uppercase tracking-wider text-zinc-600">
        {label}
      </p>
      <p className="text-[13px] text-zinc-300 mt-0.5 font-mono">{value}</p>
    </div>
  );
}

/* ── TTS Auto-Mode Selector ──────────────────────── */

function AutoModeSelector({
  current,
  onSelect,
  loading,
}: {
  current: string;
  onSelect: (mode: string) => void;
  loading: boolean;
}) {
  return (
    <div className="space-y-2">
      <p className="text-[11px] font-medium uppercase tracking-wider text-zinc-500">
        Auto-TTS Mode
      </p>
      <div className="grid grid-cols-2 gap-2">
        {AUTO_MODES.map((m) => (
          <button
            key={m.value}
            onClick={() => onSelect(m.value)}
            disabled={loading}
            className={cn(
              "rounded-lg border px-3 py-2.5 text-left transition-all",
              current === m.value
                ? "border-violet-500/30 bg-violet-500/10"
                : "border-white/[0.06] bg-white/[0.02] hover:border-white/[0.12]"
            )}
          >
            <p
              className={cn(
                "text-[12px] font-medium",
                current === m.value ? "text-violet-300" : "text-zinc-300"
              )}
            >
              {m.label}
            </p>
            <p className="text-[10px] text-zinc-600 mt-0.5">{m.desc}</p>
          </button>
        ))}
      </div>
    </div>
  );
}

/* ── TTS Settings Panel ──────────────────────────── */

function TtsSettingsPanel({
  status,
  prefs,
  onUpdateConfig,
  loading,
}: {
  status: TtsStatus;
  prefs: TtsPrefs | null;
  onUpdateConfig: (section: string, config: Record<string, unknown>) => void;
  loading: boolean;
}) {
  const [summaryThreshold, setSummaryThreshold] = useState(
    prefs?.maxLength?.toString() || "1500"
  );
  const [summarize, setSummarize] = useState(prefs?.summarize !== false);

  // Re-sync local state when props change after a refetch
  useEffect(() => {
    setSummaryThreshold(prefs?.maxLength?.toString() || "1500");
    setSummarize(prefs?.summarize !== false);
  }, [prefs]);

  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4 space-y-4">
      <div className="flex items-center gap-2 text-[13px] font-semibold text-zinc-200">
        <Settings2 className="h-4 w-4 text-zinc-400" />
        TTS Settings
      </div>

      {/* Fallback chain */}
      <div>
        <p className="text-[11px] font-medium uppercase tracking-wider text-zinc-500 mb-1.5">
          Provider Fallback Chain
        </p>
        <div className="flex items-center gap-2">
          <span className="rounded-md border border-violet-500/30 bg-violet-500/15 px-2 py-1 text-[12px] font-medium text-violet-300">
            {status.provider}
          </span>
          {status.fallbackProviders?.map((fp, i) => (
            <div key={fp} className="flex items-center gap-2">
              <span className="text-[10px] text-zinc-600">→</span>
              <span className="rounded-md border border-white/[0.08] bg-white/[0.03] px-2 py-1 text-[12px] text-zinc-400">
                {fp}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* API Key status */}
      <div>
        <p className="text-[11px] font-medium uppercase tracking-wider text-zinc-500 mb-1.5">
          API Keys
        </p>
        <div className="grid grid-cols-3 gap-2">
          {[
            { name: "OpenAI", has: status.hasOpenAIKey },
            { name: "ElevenLabs", has: status.hasElevenLabsKey },
            { name: "Edge TTS", has: status.edgeEnabled },
          ].map((k) => (
            <div
              key={k.name}
              className={cn(
                "flex items-center gap-2 rounded-lg border px-3 py-2 text-[12px]",
                k.has
                  ? "border-emerald-500/20 bg-emerald-500/[0.05] text-emerald-400"
                  : "border-white/[0.06] bg-white/[0.02] text-zinc-600"
              )}
            >
              {k.has ? (
                <Check className="h-3.5 w-3.5" />
              ) : (
                <X className="h-3.5 w-3.5" />
              )}
              {k.name}
            </div>
          ))}
        </div>
      </div>

      {/* Summary settings */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-[11px] font-medium uppercase tracking-wider text-zinc-500">
            Auto-Summarize Long Replies
          </p>
          <button
            onClick={() => {
              const newVal = !summarize;
              setSummarize(newVal);
              onUpdateConfig("tts", {
                auto: status.auto,
                summarize: newVal,
                maxTextLength: parseInt(summaryThreshold) || 1500,
              });
            }}
            disabled={loading}
            className={cn(
              "relative h-5 w-9 rounded-full transition-colors",
              summarize ? "bg-violet-500" : "bg-zinc-700"
            )}
          >
            <span
              className={cn(
                "absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform",
                summarize ? "left-[18px]" : "left-0.5"
              )}
            />
          </button>
        </div>
        {summarize && (
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-zinc-500">Threshold:</span>
            <input
              type="number"
              value={summaryThreshold}
              onChange={(e) => setSummaryThreshold(e.target.value)}
              className="w-24 rounded-md border border-white/[0.08] bg-black/30 px-2 py-1 text-[12px] text-zinc-300 outline-none"
              placeholder="1500"
            />
            <span className="text-[11px] text-zinc-600">chars</span>
          </div>
        )}
      </div>

      {/* Output format info */}
      <div className="rounded-lg border border-white/[0.04] bg-black/20 px-3 py-2.5">
        <p className="text-[11px] font-medium text-zinc-400 mb-1">Output Formats</p>
        <div className="space-y-1 text-[11px] text-zinc-500">
          <p><span className="text-zinc-400">Telegram:</span> Opus voice note (48kHz/64kbps)</p>
          <p><span className="text-zinc-400">Other channels:</span> MP3 (44.1kHz/128kbps)</p>
          <p><span className="text-zinc-400">Edge TTS:</span> audio-24khz-48kbitrate-mono-mp3</p>
        </div>
      </div>
    </div>
  );
}

/* ── Main AudioView ──────────────────────────────── */

export function AudioView() {
  const [data, setData] = useState<AudioFullState | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [testing, setTesting] = useState(false);
  const [toast, setToast] = useState<Toast | null>(null);
  const [testResult, setTestResult] = useState<{
    provider: string;
    format: string;
    path: string;
    voiceCompatible: boolean;
    key: number; // force remount for auto-play
  } | null>(null);

  /* ── Fetch ─────────────── */

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch("/api/audio");
      if (!res.ok) throw new Error("Failed");
      const json = await res.json();
      setData(json);
    } catch (err) {
      console.error("Audio fetch error:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  /* ── Actions ───────────── */

  const toggleTts = useCallback(async () => {
    if (!data) return;
    const newEnabled = !data.status.enabled;
    // Optimistic update
    setData((prev) =>
      prev ? { ...prev, status: { ...prev.status, enabled: newEnabled } } : prev
    );
    setActionLoading(true);
    try {
      const action = newEnabled ? "enable" : "disable";
      const res = await fetch("/api/audio", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const json = await res.json();
      if (json.ok) {
        setToast({ message: `TTS ${action}d`, type: "success" });
        await fetchData();
      } else {
        setToast({ message: json.error || "Failed", type: "error" });
        // Revert optimistic update
        setData((prev) =>
          prev ? { ...prev, status: { ...prev.status, enabled: !newEnabled } } : prev
        );
      }
    } catch (err) {
      setToast({ message: String(err), type: "error" });
      setData((prev) =>
        prev ? { ...prev, status: { ...prev.status, enabled: !newEnabled } } : prev
      );
    } finally {
      setActionLoading(false);
    }
  }, [data, fetchData]);

  const setProvider = useCallback(
    async (provider: string) => {
      // Optimistic update
      setData((prev) =>
        prev
          ? {
              ...prev,
              status: { ...prev.status, provider },
              providers: { ...prev.providers, active: provider },
            }
          : prev
      );
      setActionLoading(true);
      try {
        const res = await fetch("/api/audio", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "set-provider", provider }),
        });
        const json = await res.json();
        if (json.ok) {
          setToast({ message: `Switched to ${provider}`, type: "success" });
          await fetchData();
        } else {
          setToast({ message: json.error || "Failed", type: "error" });
          await fetchData(); // Revert by refetching
        }
      } catch (err) {
        setToast({ message: String(err), type: "error" });
        await fetchData();
      } finally {
        setActionLoading(false);
      }
    },
    [fetchData]
  );

  const testTts = useCallback(
    async (text: string, provider?: string, voice?: string) => {
      setTesting(true);
      setTestResult(null);
      try {
        const body: Record<string, unknown> = { action: "test", text };
        if (provider) body.provider = provider;
        if (voice) body.voice = voice;
        const res = await fetch("/api/audio", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const json = await res.json();
        if (json.ok) {
          setTestResult({
            provider: json.provider || "unknown",
            format: json.outputFormat || "mp3",
            path: json.audioPath || "",
            voiceCompatible: json.voiceCompatible ?? false,
            key: Date.now(),
          });
          setToast({
            message: `Audio generated — click play to listen`,
            type: "success",
          });
        } else {
          setToast({ message: json.error || "Generation failed", type: "error" });
        }
      } catch (err) {
        setToast({ message: String(err), type: "error" });
      } finally {
        setTesting(false);
      }
    },
    []
  );

  const updateConfig = useCallback(
    async (section: string, config: Record<string, unknown>) => {
      setActionLoading(true);
      try {
        const res = await fetch("/api/audio", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "update-config", section, config }),
        });
        const json = await res.json();
        if (json.ok) {
          setToast({ message: `Updated ${section} config`, type: "success" });
          // Re-fetch so everything syncs from the source of truth
          await fetchData();
        } else {
          setToast({ message: json.error || "Failed", type: "error" });
          await fetchData(); // revert
        }
      } catch (err) {
        setToast({ message: String(err), type: "error" });
        await fetchData();
      } finally {
        setActionLoading(false);
      }
    },
    [fetchData]
  );

  const updateAutoMode = useCallback(
    async (mode: string) => {
      // Optimistic update
      setData((prev) =>
        prev ? { ...prev, status: { ...prev.status, auto: mode } } : prev
      );
      await updateConfig("tts", { auto: mode });
    },
    [updateConfig]
  );

  /* ── Render ────────────── */

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-violet-400" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex flex-1 items-center justify-center text-[13px] text-zinc-500">
        Failed to load audio configuration
      </div>
    );
  }

  const {
    status,
    providers: providersData,
    config: configData,
    prefs,
  } = data;

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-white/[0.06] px-6 py-4">
        <div>
          <h1 className="text-[18px] font-semibold text-zinc-100 flex items-center gap-2">
            <Volume2 className="h-5 w-5 text-violet-400" />
            Audio & Voice
          </h1>
          <p className="text-[12px] text-zinc-500 mt-0.5">
            Text-to-speech, Talk Mode, and audio understanding configuration
          </p>
        </div>
        <div className="flex items-center gap-3">
          {/* TTS toggle */}
          <button
            onClick={toggleTts}
            disabled={actionLoading}
            className={cn(
              "flex items-center gap-2 rounded-lg px-4 py-2 text-[13px] font-medium transition-colors",
              status.enabled
                ? "bg-violet-600/20 text-violet-300 hover:bg-violet-600/30"
                : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-300"
            )}
          >
            {status.enabled ? (
              <>
                <Volume2 className="h-4 w-4" />
                TTS Enabled
              </>
            ) : (
              <>
                <VolumeX className="h-4 w-4" />
                TTS Disabled
              </>
            )}
          </button>
          <button
            onClick={fetchData}
            className="rounded-lg p-2 text-zinc-500 transition-colors hover:bg-white/[0.06] hover:text-zinc-300"
          >
            <RefreshCw className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
        {/* Status overview */}
        <div className="grid grid-cols-4 gap-3">
          <StatusCard
            label="Status"
            value={status.enabled ? "Active" : "Disabled"}
            icon={status.enabled ? Volume2 : VolumeX}
            color={status.enabled ? "text-emerald-400" : "text-zinc-500"}
          />
          <StatusCard
            label="Active Provider"
            value={providersData.active || status.provider}
            icon={Speaker}
            color="text-violet-400"
          />
          <StatusCard
            label="Auto Mode"
            value={status.auto}
            icon={Waves}
            color="text-sky-400"
          />
          <StatusCard
            label="Providers"
            value={`${providersData.providers.filter((p) => p.configured).length} configured`}
            icon={Globe}
            color="text-amber-400"
          />
        </div>

        {/* Auto mode selector */}
        <AutoModeSelector
          current={status.auto}
          onSelect={updateAutoMode}
          loading={actionLoading}
        />

        {/* Providers */}
        <div>
          <h2 className="text-[14px] font-semibold text-zinc-200 mb-3 flex items-center gap-2">
            <Speaker className="h-4 w-4 text-violet-400" />
            TTS Providers
          </h2>
          <div className="space-y-2">
            {providersData.providers.map((p) => (
              <ProviderCard
                key={p.id}
                provider={p}
                isActive={providersData.active === p.id}
                onSelect={() => setProvider(p.id)}
                loading={actionLoading}
                onTest={(pid, voice) =>
                  testTts(
                    "Hello! This is a test of the text to speech system.",
                    pid,
                    voice
                  )
                }
              />
            ))}
          </div>
        </div>

        {/* Test TTS */}
        <TtsTestPanel onTest={testTts} testing={testing} />

        {/* Test result with audio player */}
        {testResult && <AudioPlayer key={testResult.key} result={testResult} />}

        {/* TTS Settings */}
        <TtsSettingsPanel
          status={status}
          prefs={prefs}
          onUpdateConfig={updateConfig}
          loading={actionLoading}
        />

        {/* Talk Mode */}
        <TalkModeSection config={configData.talk.resolved || {}} />

        {/* Audio Understanding */}
        <AudioUnderstandingSection
          config={configData.audioUnderstanding.resolved || {}}
        />

        {/* Slash commands reference */}
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4 space-y-3">
          <div className="flex items-center gap-2 text-[13px] font-semibold text-zinc-200">
            <Zap className="h-4 w-4 text-amber-400" />
            Slash Commands
          </div>
          <p className="text-[12px] text-zinc-500">
            Control TTS from any channel using slash commands:
          </p>
          <div className="rounded-lg bg-black/30 p-3 font-mono text-[12px] text-zinc-400 space-y-1">
            <p><span className="text-violet-400">/tts</span> off &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;<span className="text-zinc-600"># Disable TTS</span></p>
            <p><span className="text-violet-400">/tts</span> always &nbsp;&nbsp;&nbsp;&nbsp;<span className="text-zinc-600"># Speak all replies</span></p>
            <p><span className="text-violet-400">/tts</span> inbound &nbsp;&nbsp;&nbsp;<span className="text-zinc-600"># Reply to voice with voice</span></p>
            <p><span className="text-violet-400">/tts</span> tagged &nbsp;&nbsp;&nbsp;&nbsp;<span className="text-zinc-600"># Only /tts tagged messages</span></p>
            <p><span className="text-violet-400">/tts</span> status &nbsp;&nbsp;&nbsp;&nbsp;<span className="text-zinc-600"># Show current state</span></p>
            <p><span className="text-violet-400">/tts</span> provider openai <span className="text-zinc-600"># Switch provider</span></p>
            <p><span className="text-violet-400">/tts</span> limit 2000 &nbsp;<span className="text-zinc-600"># Summary threshold</span></p>
            <p><span className="text-violet-400">/tts</span> audio Hello! &nbsp;<span className="text-zinc-600"># One-off TTS</span></p>
          </div>
          <p className="text-[11px] text-zinc-600">
            Note: Discord uses <code className="rounded bg-white/[0.06] px-1 text-[10px]">/voice</code> instead
            (because <code className="rounded bg-white/[0.06] px-1 text-[10px]">/tts</code> is a built-in Discord command).
          </p>
        </div>

        {/* Gateway RPC reference */}
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4 space-y-3">
          <div className="flex items-center gap-2 text-[13px] font-semibold text-zinc-200">
            <Radio className="h-4 w-4 text-sky-400" />
            Gateway RPC Methods
          </div>
          <div className="grid grid-cols-3 gap-2">
            {[
              "tts.status",
              "tts.enable",
              "tts.disable",
              "tts.convert",
              "tts.setProvider",
              "tts.providers",
            ].map((m) => (
              <div
                key={m}
                className="rounded-lg border border-white/[0.06] bg-black/20 px-3 py-2 font-mono text-[11px] text-sky-400"
              >
                {m}
              </div>
            ))}
          </div>
        </div>
      </div>

      {toast && <ToastBar toast={toast} onDone={() => setToast(null)} />}
    </div>
  );
}

/* ── Status Card ─────────────────────────────────── */

function StatusCard({
  label,
  value,
  icon: Icon,
  color,
}: {
  label: string;
  value: string;
  icon: React.ComponentType<{ className?: string }>;
  color: string;
}) {
  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
      <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-wider text-zinc-500 mb-1">
        <Icon className={cn("h-3.5 w-3.5", color)} />
        {label}
      </div>
      <p className="text-[16px] font-semibold text-zinc-200 capitalize">{value}</p>
    </div>
  );
}
