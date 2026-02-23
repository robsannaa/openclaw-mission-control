"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { QrCode, RefreshCw, Check, X, AlertTriangle, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

type QrLoginModalProps = {
  channel: "whatsapp" | "signal";
  account?: string;
  onSuccess?: () => void;
  onClose: () => void;
};

type StreamState = "connecting" | "scanning" | "success" | "error" | "timeout";

const CHANNEL_LABELS: Record<string, string> = {
  whatsapp: "WhatsApp",
  signal: "Signal",
};

export function QrLoginModal({
  channel,
  account,
  onSuccess,
  onClose,
}: QrLoginModalProps) {
  const [state, setState] = useState<StreamState>("connecting");
  const [qrText, setQrText] = useState("");
  const [logs, setLogs] = useState<string[]>([]);
  const [errorMsg, setErrorMsg] = useState("");
  const eventSourceRef = useRef<EventSource | null>(null);
  const mountedRef = useRef(true);

  const connect = useCallback(() => {
    // Close any existing connection.
    eventSourceRef.current?.close();

    setState("connecting");
    setQrText("");
    setErrorMsg("");

    const params = new URLSearchParams({ channel });
    if (account) params.set("account", account);

    const es = new EventSource(`/api/channels/qr?${params}`);
    eventSourceRef.current = es;

    es.onmessage = (event) => {
      if (!mountedRef.current) return;
      try {
        const data = JSON.parse(event.data) as {
          type: string;
          data?: string;
        };

        switch (data.type) {
          case "qr":
            if (data.data) {
              setQrText(data.data);
              setState("scanning");
            }
            break;

          case "log":
            if (data.data) {
              setLogs((prev) => [...prev.slice(-30), data.data!]);
              // Detect success patterns in log output.
              const lower = data.data.toLowerCase();
              if (
                lower.includes("authenticated") ||
                lower.includes("logged in") ||
                lower.includes("successfully")
              ) {
                setState("success");
                onSuccess?.();
                es.close();
              }
            }
            break;

          case "done":
            if (data.data?.toLowerCase().includes("successful")) {
              setState("success");
              onSuccess?.();
            } else {
              setState("error");
              setErrorMsg(data.data || "Login process ended");
            }
            es.close();
            break;

          case "error":
            setState("error");
            setErrorMsg(data.data || "Unknown error");
            es.close();
            break;

          case "ping":
            // Keepalive — no action needed.
            break;
        }
      } catch {
        // Ignore malformed SSE data.
      }
    };

    es.onerror = () => {
      if (!mountedRef.current) return;
      // EventSource auto-reconnects, but if the state is still "connecting"
      // after the first error, the endpoint likely isn't available.
      if (state === "connecting") {
        setState("error");
        setErrorMsg("Could not connect to login service. Is the gateway running?");
      }
    };
  }, [channel, account, onSuccess, state]);

  useEffect(() => {
    mountedRef.current = true;
    connect();
    return () => {
      mountedRef.current = false;
      eventSourceRef.current?.close();
    };
    // Only run on mount (connect is stable via useCallback deps).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const label = CHANNEL_LABELS[channel] || channel;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="relative mx-4 w-full max-w-md rounded-2xl border border-foreground/10 bg-card p-6 shadow-2xl">
        {/* Header */}
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <QrCode className="h-5 w-5 text-violet-400" />
            <h2 className="text-sm font-semibold">{label} Login</h2>
          </div>
          <button
            onClick={onClose}
            className="rounded-md p-1 text-muted-foreground transition hover:bg-muted hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* ── Connecting ──────────────────────────────── */}
        {state === "connecting" && (
          <div className="flex flex-col items-center gap-3 py-10">
            <Loader2 className="h-8 w-8 animate-spin text-violet-400" />
            <p className="text-sm text-muted-foreground">
              Starting login session...
            </p>
          </div>
        )}

        {/* ── Scanning (QR visible) ──────────────────── */}
        {state === "scanning" && qrText && (
          <div className="flex flex-col items-center gap-4">
            <p className="text-xs text-muted-foreground">
              Scan this QR code with your{" "}
              <span className="font-medium text-foreground">{label}</span> app
            </p>
            <div className="overflow-hidden rounded-lg border border-foreground/10 bg-black p-3">
              <pre
                className={cn(
                  "select-none whitespace-pre font-mono text-white",
                  "text-[5px] leading-[6px]",
                  "sm:text-[6px] sm:leading-[7px]",
                )}
              >
                {qrText}
              </pre>
            </div>
            <p className="text-center text-[11px] text-muted-foreground/60">
              QR code refreshes automatically. Keep this window open until login
              completes.
            </p>
          </div>
        )}

        {/* ── Success ────────────────────────────────── */}
        {state === "success" && (
          <div className="flex flex-col items-center gap-3 py-10">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-500/10">
              <Check className="h-8 w-8 text-emerald-400" />
            </div>
            <p className="text-sm font-medium text-emerald-300">
              Login successful!
            </p>
            <p className="text-center text-xs text-muted-foreground">
              {label} is now connected. A gateway restart may be needed to
              activate the channel.
            </p>
            <button
              onClick={onClose}
              className="mt-2 rounded-md bg-emerald-600 px-4 py-1.5 text-xs font-medium text-white transition hover:bg-emerald-500"
            >
              Done
            </button>
          </div>
        )}

        {/* ── Error ──────────────────────────────────── */}
        {state === "error" && (
          <div className="flex flex-col items-center gap-3 py-10">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-red-500/10">
              <AlertTriangle className="h-8 w-8 text-red-400" />
            </div>
            <p className="text-sm text-red-300">
              {errorMsg || "Login failed"}
            </p>
            <button
              onClick={connect}
              className="mt-1 flex items-center gap-1.5 rounded-md bg-muted px-3 py-1.5 text-xs font-medium text-foreground transition hover:bg-muted/80"
            >
              <RefreshCw className="h-3 w-3" />
              Retry
            </button>
          </div>
        )}

        {/* ── Log output (collapsible) ───────────────── */}
        {logs.length > 0 && (
          <details className="mt-4">
            <summary className="cursor-pointer text-[11px] text-muted-foreground/60 hover:text-muted-foreground">
              Show login log ({logs.length} entries)
            </summary>
            <pre className="mt-2 max-h-32 overflow-auto rounded-md bg-muted/50 p-2 text-[11px] leading-relaxed text-muted-foreground">
              {logs.join("\n")}
            </pre>
          </details>
        )}
      </div>
    </div>
  );
}
