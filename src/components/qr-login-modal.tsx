"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  Check,
  Loader2,
  QrCode,
  RefreshCw,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";

type QrLoginModalProps = {
  channel: "whatsapp" | "signal";
  account?: string;
  onSuccess?: () => void;
  onClose: () => void;
};

type StreamState = "connecting" | "scanning" | "success" | "error";

const CHANNEL_LABELS: Record<QrLoginModalProps["channel"], string> = {
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
  const [errorMessage, setErrorMessage] = useState("");

  const eventSourceRef = useRef<EventSource | null>(null);
  const mountedRef = useRef(true);
  const notifiedSuccessRef = useRef(false);

  const finishSuccess = useCallback(() => {
    if (notifiedSuccessRef.current) return;
    notifiedSuccessRef.current = true;
    setState("success");
    onSuccess?.();
  }, [onSuccess]);

  const closeStream = useCallback(() => {
    eventSourceRef.current?.close();
    eventSourceRef.current = null;
  }, []);

  const connect = useCallback((resetUi = true) => {
    closeStream();
    notifiedSuccessRef.current = false;
    if (resetUi) {
      setState("connecting");
      setQrText("");
      setLogs([]);
      setErrorMessage("");
    }

    const params = new URLSearchParams({ channel });
    if (account) params.set("account", account);

    const es = new EventSource(`/api/channels/qr?${params.toString()}`);
    eventSourceRef.current = es;

    es.onmessage = (event) => {
      if (!mountedRef.current) return;

      try {
        const payload = JSON.parse(event.data) as {
          type?: string;
          data?: string;
        };

        switch (payload.type) {
          case "qr": {
            if (!payload.data) return;
            setQrText(payload.data);
            setState("scanning");
            return;
          }
          case "log": {
            if (!payload.data) return;
            setLogs((prev) => [...prev.slice(-49), payload.data as string]);
            const lower = payload.data.toLowerCase();
            if (
              lower.includes("authenticated") ||
              lower.includes("login successful") ||
              lower.includes("logged in")
            ) {
              finishSuccess();
              closeStream();
            }
            return;
          }
          case "done": {
            const lower = (payload.data || "").toLowerCase();
            if (lower.includes("successful")) {
              finishSuccess();
            } else {
              setState("error");
              setErrorMessage(payload.data || "Login process ended unexpectedly.");
            }
            closeStream();
            return;
          }
          case "error": {
            setState("error");
            setErrorMessage(payload.data || "Login failed.");
            closeStream();
            return;
          }
          default:
            return;
        }
      } catch {
        // Ignore malformed stream payloads.
      }
    };

    es.onerror = () => {
      if (!mountedRef.current || notifiedSuccessRef.current) return;
      setState("error");
      setErrorMessage("Could not connect to the login session.");
      closeStream();
    };
  }, [account, channel, closeStream, finishSuccess]);

  useEffect(() => {
    mountedRef.current = true;
    const timer = window.setTimeout(() => connect(false), 0);

    return () => {
      window.clearTimeout(timer);
      mountedRef.current = false;
      closeStream();
    };
  }, [closeStream, connect]);

  const label = CHANNEL_LABELS[channel];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="mx-4 w-full max-w-lg rounded-2xl border border-foreground/10 bg-card p-6 shadow-2xl">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <QrCode className="h-5 w-5 text-blue-600 dark:text-blue-400" />
            <h2 className="text-sm font-semibold text-foreground">{label} Login</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            aria-label="Close QR login"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {state === "connecting" && (
          <div className="flex flex-col items-center gap-3 py-10">
            <Loader2 className="h-8 w-8 animate-spin text-blue-600 dark:text-blue-400" />
            <p className="text-sm text-muted-foreground">Starting login session...</p>
          </div>
        )}

        {state === "scanning" && qrText && (
          <div className="flex flex-col items-center gap-4">
            <p className="text-center text-xs text-muted-foreground">
              Scan this QR code with your <span className="font-medium text-foreground">{label}</span> app
            </p>
            <div className="rounded-lg border border-foreground/10 bg-white p-3">
              <pre
                className={cn(
                  "overflow-auto whitespace-pre text-black",
                  "text-[6px] leading-[1] sm:text-[8px]",
                )}
                style={{ fontFamily: '"DejaVu Sans Mono", "Geist Mono", monospace' }}
              >
                {qrText}
              </pre>
            </div>
            <p className="text-center text-[11px] text-muted-foreground/60">
              QR code refreshes automatically. Keep this window open until login completes.
            </p>
          </div>
        )}

        {state === "success" && (
          <div className="flex flex-col items-center gap-3 py-10">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-500/10">
              <Check className="h-8 w-8 text-emerald-400" />
            </div>
            <p className="text-sm font-medium text-emerald-300">Login successful!</p>
            <p className="text-center text-xs text-muted-foreground">
              {label} is connected. You can finish onboarding and start chatting with your agent.
            </p>
            <button
              type="button"
              onClick={onClose}
              className="mt-2 rounded-md bg-emerald-600 px-4 py-1.5 text-xs font-medium text-white transition-colors hover:bg-emerald-500"
            >
              Done
            </button>
          </div>
        )}

        {state === "error" && (
          <div className="flex flex-col items-center gap-3 py-10">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-red-500/10">
              <AlertTriangle className="h-8 w-8 text-red-400" />
            </div>
            <p className="text-center text-sm text-red-300">{errorMessage || "Login failed."}</p>
            <button
              type="button"
              onClick={connect}
              className="mt-1 inline-flex items-center gap-1.5 rounded-md bg-muted px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted/80"
            >
              <RefreshCw className="h-3 w-3" />
              Retry
            </button>
          </div>
        )}

        {logs.length > 0 && (
          <details className="mt-4">
            <summary className="cursor-pointer text-[11px] text-muted-foreground/60 transition-colors hover:text-muted-foreground">
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
