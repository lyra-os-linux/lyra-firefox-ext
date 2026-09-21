import { t } from "./i18n.js";
// Protocolo com o native host (org.lyraos.downloads). Versão 1.

export const HOST_NAME = "org.lyraos.downloads";
export const PROTOCOL_VERSION = 1;

export type HostOp =
  | { op: "health" }
  | { op: "open_app" }
  | { op: "send_download"; url: string; suggested_filename?: string }
  | { op: "handoff"; url: string; suggested_filename?: string }
  | { op: "cancel_handoff" };

export interface HostResponse {
  v: number;
  request_id: string | null;
  ok: boolean;
  result?: any;
  error?: { code: string; message: string };
}

export type HostResult =
  | { kind: "ok"; result: any }
  | { kind: "error"; code: string; message: string }
  | { kind: "host_missing"; message: string }
  | { kind: "timeout" };

export type SendNative = (host: string, msg: object) => Promise<unknown>;

export function newRequestId(): string {
  return crypto.randomUUID();
}

/** Native errors follow the browser language, independently of the daemon's locale. */
function errorMessage(code: string): string {
  switch (code) {
    case "invalid_url": return t("errNativeUrl");
    case "invalid_destination": return t("errNativeDestination");
    case "app_unavailable": return t("errNativeApp");
    case "unsupported_version": return t("errNativeVersion");
    case "invalid_request":
    case "too_large": return t("errNativeRequest");
    case "backend_error": return t("errNativeBackend");
    default: return t("errUnknown");
  }
}

/** Envia uma mensagem ao host com timeout. Distingue host ausente (não
 * instalado/registrado), erro estruturado e timeout (resultado incerto). */
export async function callHost(
  send: SendNative,
  requestId: string,
  op: HostOp,
  timeoutMs: number,
): Promise<HostResult> {
  const msg = { v: PROTOCOL_VERSION, request_id: requestId, ...op };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<HostResult>((resolve) => {
    timer = setTimeout(() => resolve({ kind: "timeout" }), timeoutMs);
  });
  const call = Promise.resolve().then(() => send(HOST_NAME, msg)).then(
    (raw): HostResult => {
      const r = raw as HostResponse;
      if (!r || typeof r !== "object") return { kind: "error", code: "invalid_response", message: t("errInvalidResponse") };
      if (r.v !== PROTOCOL_VERSION || (r.request_id !== null && r.request_id !== requestId) || (r.ok && r.request_id !== requestId)) {
        return { kind: "error", code: "invalid_response", message: t("errWrongResponse") };
      }
      if (r.ok) return { kind: "ok", result: r.result };
      const code = r.error?.code ?? "unknown";
      return { kind: "error", code, message: errorMessage(code) };
    },
    (e: unknown): HostResult => {
      const text = String((e as Error)?.message ?? e);
      if (/No such native application|not found|Access to the specified native messaging host is forbidden/i.test(text)) {
        return {
          kind: "host_missing",
          message: t("errHostMissing"),
        };
      }
      return { kind: "error", code: "host_failed", message: t("errHostFailed") };
    },
  );
  try {
    return await Promise.race([call, timeout]);
  } finally {
    clearTimeout(timer);
  }
}
