import { getGatewayToken, getGatewayUrl } from "./paths";

type GatewayConnectHello = {
  features?: {
    methods?: string[];
  };
};

type GatewayErrorPayload = {
  code?: string;
  message?: string;
  details?: unknown;
};

type GatewayEventMessage = {
  type: "event";
  event?: string;
};

type GatewayResponseMessage = {
  type: "res";
  id?: string;
  ok?: boolean;
  payload?: unknown;
  error?: GatewayErrorPayload;
};

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function toWsUrl(url: string): string {
  const parsed = new URL(url);
  parsed.protocol = parsed.protocol === "https:" ? "wss:" : "ws:";
  return parsed.toString();
}

export class GatewayRpcError extends Error {
  code?: string;
  details?: unknown;

  constructor(message: string, code?: string, details?: unknown) {
    super(message);
    this.name = "GatewayRpcError";
    this.code = code;
    this.details = details;
  }
}

export class GatewayRpcClient {
  private ws: WebSocket | null = null;
  private connectPromise: Promise<void> | null = null;
  private connectResolve: (() => void) | null = null;
  private connectReject: ((error: Error) => void) | null = null;
  private connectRequestId: string | null = null;
  private connectRequestSent = false;
  private connectTimeoutTimer: ReturnType<typeof setTimeout> | null = null;
  private connectKickTimer: ReturnType<typeof setTimeout> | null = null;
  private supportedMethods = new Set<string>();
  private pending = new Map<string, PendingRequest>();
  private seq = 0;
  private readonly token: string;
  private readonly gatewayUrl?: string;

  constructor(gatewayUrl?: string, token?: string) {
    this.gatewayUrl = gatewayUrl;
    this.token = token ?? getGatewayToken();
  }

  async request<T>(
    method: string,
    params: Record<string, unknown> = {},
    timeout = 15000,
  ): Promise<T> {
    await this.connect(timeout);

    if (this.supportedMethods.size > 0 && !this.supportedMethods.has(method)) {
      throw new GatewayRpcError(`Gateway does not support method: ${method}`, "UNSUPPORTED_METHOD");
    }

    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      throw new GatewayRpcError("Gateway RPC socket is not connected");
    }

    const id = this.nextId();
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new GatewayRpcError(`Gateway RPC timed out for ${method}`));
      }, timeout);

      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject, timer });

      try {
        ws.send(
          JSON.stringify({
            type: "req",
            id,
            method,
            params,
          }),
        );
      } catch (err) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(this.normalizeError(err));
      }
    });
  }

  private async connect(timeout: number): Promise<void> {
    if (this.ws?.readyState === WebSocket.OPEN && this.connectRequestId === null) {
      return;
    }
    if (this.connectPromise) {
      return this.connectPromise;
    }

    this.connectPromise = new Promise<void>(async (resolve, reject) => {
      const onResolve = () => {
        this.clearConnectState();
        this.connectPromise = null;
        resolve();
      };
      const onReject = (error: Error) => {
        this.clearConnectState();
        this.connectPromise = null;
        this.closeSocket();
        reject(error);
      };

      this.connectResolve = onResolve;
      this.connectReject = onReject;
      this.connectRequestId = this.nextId();
      this.connectRequestSent = false;

      const timer = setTimeout(() => {
        onReject(new GatewayRpcError("Gateway RPC connect timed out"));
      }, timeout);
      this.connectTimeoutTimer = timer;

      try {
        const wsUrl = toWsUrl(this.gatewayUrl ?? (await getGatewayUrl()));
        const ws = new WebSocket(wsUrl);
        this.ws = ws;

        ws.addEventListener("open", () => {
          this.scheduleConnectRequest();
        });
        ws.addEventListener("message", (event) => {
          this.handleMessage(String(event.data ?? ""));
        });
        ws.addEventListener("close", (event) => {
          const reason = String(event.reason || "socket closed");
          this.handleSocketClosed(
            new GatewayRpcError(`Gateway RPC socket closed (${event.code}): ${reason}`),
          );
        });
        ws.addEventListener("error", () => {
          if (this.ws?.readyState !== WebSocket.OPEN && this.connectReject) {
            this.connectReject(new GatewayRpcError("Gateway RPC socket error"));
          }
        });
      } catch (err) {
        clearTimeout(timer);
        onReject(this.normalizeError(err));
      }
    });

    return this.connectPromise;
  }

  private handleMessage(raw: string): void {
    let message: GatewayEventMessage | GatewayResponseMessage;
    try {
      message = JSON.parse(raw) as GatewayEventMessage | GatewayResponseMessage;
    } catch {
      return;
    }

    if (message.type === "event") {
      if (message.event === "connect.challenge") {
        this.sendConnectRequest();
      }
      return;
    }

    if (message.type !== "res") {
      return;
    }

    if (message.id && message.id === this.connectRequestId) {
      if (message.ok) {
        const hello = (message.payload || {}) as GatewayConnectHello;
        this.supportedMethods = new Set(hello.features?.methods || []);
        this.connectResolve?.();
      } else {
        this.connectReject?.(this.normalizeGatewayError(message.error));
      }
      return;
    }

    const pending = message.id ? this.pending.get(message.id) : undefined;
    if (!pending || !message.id) {
      return;
    }

    clearTimeout(pending.timer);
    this.pending.delete(message.id);

    if (message.ok) {
      pending.resolve(message.payload);
      return;
    }

    pending.reject(this.normalizeGatewayError(message.error));
  }

  private scheduleConnectRequest(): void {
    if (this.connectRequestSent || this.connectKickTimer) {
      return;
    }
    const timer = setTimeout(() => {
      this.connectKickTimer = null;
      this.sendConnectRequest();
    }, 750);
    this.connectKickTimer = timer;
  }

  private sendConnectRequest(): void {
    if (this.connectRequestSent || !this.connectRequestId) {
      return;
    }
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      return;
    }

    this.connectRequestSent = true;
    if (this.connectKickTimer) {
      clearTimeout(this.connectKickTimer);
      this.connectKickTimer = null;
    }

    ws.send(
      JSON.stringify({
        type: "req",
        id: this.connectRequestId,
        method: "connect",
        params: {
          minProtocol: 3,
          maxProtocol: 3,
          client: {
            id: "openclaw-dashboard",
            version: "mission-control",
            platform: process.platform,
            mode: "backend",
            instanceId: `pid-${process.pid}`,
          },
          role: "operator",
          scopes: ["operator.admin", "operator.approvals", "operator.pairing"],
          caps: [],
          ...(this.token ? { auth: { token: this.token } } : {}),
          locale: "en-US",
          userAgent: "@openclaw/dashboard",
        },
      }),
    );
  }

  private handleSocketClosed(error: Error): void {
    if (this.connectReject) {
      this.connectReject(error);
    }
    for (const [id, pending] of this.pending.entries()) {
      clearTimeout(pending.timer);
      pending.reject(error);
      this.pending.delete(id);
    }
    this.supportedMethods.clear();
    this.closeSocket();
  }

  private clearConnectState(): void {
    if (this.connectTimeoutTimer) {
      clearTimeout(this.connectTimeoutTimer);
      this.connectTimeoutTimer = null;
    }
    if (this.connectKickTimer) {
      clearTimeout(this.connectKickTimer);
      this.connectKickTimer = null;
    }
    this.connectResolve = null;
    this.connectReject = null;
    this.connectRequestId = null;
    this.connectRequestSent = false;
  }

  private closeSocket(): void {
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        // ignore
      }
    }
    this.ws = null;
  }

  private nextId(): string {
    this.seq += 1;
    return `mc-${this.seq}`;
  }

  private normalizeGatewayError(error: GatewayErrorPayload | undefined): GatewayRpcError {
    if (isRecord(error)) {
      return new GatewayRpcError(
        String(error.message || error.code || "Gateway request failed"),
        typeof error.code === "string" ? error.code : undefined,
        error.details,
      );
    }
    return new GatewayRpcError("Gateway request failed");
  }

  private normalizeError(error: unknown): GatewayRpcError {
    if (error instanceof GatewayRpcError) {
      return error;
    }
    return new GatewayRpcError(error instanceof Error ? error.message : String(error));
  }
}
