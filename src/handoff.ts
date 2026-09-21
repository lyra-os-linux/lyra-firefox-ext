import { t } from "./i18n.js";
// Repasse durável: só devolver ao Firefox depois de confirmar que o Lyra
// desistiu desta requisição. Respostas perdidas deixam o Firefox pausado.
import type { DownloadInfo } from "./rules.js";
import { basename } from "./rules.js";
import type { HostOp, HostResult } from "./protocol.js";

export type HandoffState =
  | "enviando" | "repassado" | "mantido_no_firefox" | "pausado_no_firefox"
  | "parado_no_firefox" | "reiniciado_no_firefox" | "repasse_incerto";

export interface HandoffEntry {
  requestId: string;
  downloadId: number;
  url: string;
  filename: string;
  state: HandoffState;
  message: string;
  time: number;
  canRestart: boolean;
  canRecover?: boolean;
  accepted?: boolean;
}

export interface HandoffSnapshot {
  entries: HandoffEntry[];
  ignoreIds: number[];
  ignoreUrls: [string, number][];
}

export interface Deps {
  pause(id: number): Promise<void>;
  resume(id: number): Promise<void>;
  cancel(id: number): Promise<void>;
  erase(id: number): Promise<void>;
  startDownload(url: string): Promise<number>;
  getDownload(id: number): Promise<{ state: string; paused: boolean } | undefined>;
  call(requestId: string, op: HostOp, timeoutMs: number): Promise<HostResult>;
  newId(): string;
  now(): number;
  changed(snapshot: HandoffSnapshot): void | Promise<void>;
}

export const HANDOFF_TIMEOUT_MS = 8000;
const RESTART_GUARD_MS = 60_000;
const MAX_ENTRIES = 20;

export class HandoffManager {
  entries: HandoffEntry[] = [];
  private ignoreIds = new Set<number>();
  private ignoreUrls = new Map<string, number>();
  private inFlight = new Set<number>();

  constructor(private deps: Deps) {}

  /** Restaura também o formato anterior, que guardava apenas entries. */
  restore(saved: Partial<HandoffSnapshot>): void {
    this.entries = structuredClone(saved.entries ?? []);
    this.ignoreIds = new Set(saved.ignoreIds ?? []);
    this.ignoreUrls = new Map((saved.ignoreUrls ?? []).filter(([, until]) => until > this.deps.now()));
    for (const entry of this.entries) {
      this.ignoreIds.add(entry.downloadId);
      if (entry.state === "enviando") this.markUncertain(entry);
    }
  }

  snapshot(): HandoffSnapshot {
    return structuredClone({
      entries: this.entries,
      ignoreIds: [...this.ignoreIds],
      ignoreUrls: [...this.ignoreUrls].filter(([, until]) => until > this.deps.now()),
    });
  }

  private async save(): Promise<void> {
    await this.deps.changed(this.snapshot());
  }

  isGuarded(item: DownloadInfo): boolean {
    if (this.ignoreIds.has(item.id) || this.inFlight.has(item.id)) return true;
    const until = this.ignoreUrls.get(item.url);
    if (until !== undefined) {
      if (this.deps.now() < until) return true;
      this.ignoreUrls.delete(item.url);
    }
    return false;
  }

  private markUncertain(entry: HandoffEntry): void {
    entry.state = "repasse_incerto";
    entry.message = t("handoffUncertain");
    entry.canRestart = false;
    entry.canRecover = true;
  }

  private async finish(entry: HandoffEntry, state: HandoffState, message: string, canRestart = false): Promise<void> {
    if (entry.state !== "enviando") return;
    entry.state = state;
    entry.message = message;
    entry.canRestart = canRestart;
    entry.canRecover = false;
    await this.save();
  }

  async handoff(item: DownloadInfo): Promise<HandoffEntry> {
    const existing = this.entries.find((e) => e.downloadId === item.id);
    if (existing) return existing;
    const entry: HandoffEntry = {
      requestId: this.deps.newId(), downloadId: item.id, url: item.url,
      filename: basename(item.filename), state: "enviando",
      message: t("handoffSending"), time: this.deps.now(), canRestart: false,
    };
    this.inFlight.add(item.id);
    this.ignoreIds.add(item.id);
    this.entries.unshift(entry);
    // Nunca descartar uma entrada que ainda precise de recuperação.
    let finished = 0;
    this.entries = this.entries.filter((e) => e.state === "enviando" || e.canRestart || e.canRecover || ++finished <= MAX_ENTRIES);
    try {
      await this.save(); // a chave deve sobreviver antes de tocar nos motores
      await this.run(entry);
    } finally {
      this.inFlight.delete(item.id);
    }
    return entry;
  }

  private async accepted(entry: HandoffEntry): Promise<void> {
    // Persistir o aceite antes de cancelar a cópia do Firefox. Ao acordar,
    // completar essa limpeza, sem cancelar a tarefa já entregue ao Lyra.
    entry.accepted = true;
    await this.save();
    try {
      await this.deps.cancel(entry.downloadId);
    } catch {
      await this.finish(entry, "pausado_no_firefox", t("handoffCleanup"));
      return;
    }
    try { await this.deps.erase(entry.downloadId); } catch { /* apenas histórico */ }
    await this.finish(entry, "repassado", t("handoffSent"));
  }

  private async resume(entry: HandoffEntry, reason: string): Promise<void> {
    try {
      await this.deps.resume(entry.downloadId);
    } catch {
      // A página pode ter caído depois de retomar e antes de persistir.
      // Não oferecer um segundo download se o primeiro já segue ou terminou.
      let current;
      try { current = await this.deps.getDownload(entry.downloadId); } catch {
        this.markUncertain(entry);
        await this.save();
        return;
      }
      if (current?.state === "complete" || (current?.state === "in_progress" && !current.paused)) {
        await this.finish(entry, "mantido_no_firefox", t("handoffInFirefox"));
        return;
      }
      await this.finish(entry, "parado_no_firefox", `${reason} ${t("handoffResumeFailed")}`, true);
      return;
    }
    await this.finish(entry, "mantido_no_firefox", `${reason} ${t("handoffResumed")}`);
  }

  private async reconcile(entry: HandoffEntry): Promise<void> {
    const res = await this.deps.call(entry.requestId, { op: "cancel_handoff" }, HANDOFF_TIMEOUT_MS);
    // revoked é uma garantia adicional do backend 0.1.1. Um backend antigo
    // com found:false não impede que um handoff atrasado chegue depois.
    if (res.kind === "ok" && res.result?.revoked === true && res.result?.completed === true) {
      await this.accepted(entry);
    } else if (res.kind === "ok" && res.result?.revoked === true && res.result?.completed === false) {
      await this.resume(entry, t("handoffCanceled"));
    } else {
      this.markUncertain(entry);
      await this.save();
    }
  }

  private async run(entry: HandoffEntry): Promise<void> {
    try { await this.deps.pause(entry.downloadId); } catch {
      await this.finish(entry, "mantido_no_firefox", t("handoffPauseFailed"));
      return;
    }
    const op: HostOp = { op: "handoff", url: entry.url, suggested_filename: entry.filename };
    let res = await this.deps.call(entry.requestId, op, HANDOFF_TIMEOUT_MS);
    const retried = res.kind === "timeout";
    if (retried) res = await this.deps.call(entry.requestId, op, HANDOFF_TIMEOUT_MS);
    if (res.kind === "ok" && res.result?.status === "accepted") {
      await this.accepted(entry);
    } else if (!retried && (res.kind === "host_missing" || (res.kind === "error" &&
      ["invalid_url", "invalid_destination", "invalid_request", "unsupported_version", "not_allowed"].includes(res.code)))) {
      await this.resume(entry, res.message);
    } else {
      await this.reconcile(entry);
    }
  }

  async recoverInFirefox(requestId: string): Promise<boolean> {
    const entry = this.entries.find((e) => e.requestId === requestId);
    if (!entry?.canRecover || this.inFlight.has(entry.downloadId)) return false;
    this.inFlight.add(entry.downloadId);
    entry.state = "enviando";
    entry.canRecover = false;
    try {
      await this.save();
      if (entry.accepted) await this.accepted(entry);
      else await this.reconcile(entry);
      return !entry.canRecover;
    } finally { this.inFlight.delete(entry.downloadId); }
  }

  async restartInFirefox(requestId: string): Promise<boolean> {
    const entry = this.entries.find((e) => e.requestId === requestId);
    if (!entry?.canRestart || this.inFlight.has(entry.downloadId)) return false;
    this.inFlight.add(entry.downloadId);
    try {
      const current = await this.deps.getDownload(entry.downloadId);
      if (current?.state === "complete" || (current?.state === "in_progress" && !current.paused)) {
        entry.canRestart = false;
        entry.state = "mantido_no_firefox";
        entry.message = t("handoffInFirefox");
        await this.save();
        return false;
      }
      this.ignoreUrls.set(entry.url, this.deps.now() + RESTART_GUARD_MS);
      // Antes da ação, persistir o estado incerto impede um segundo reinício
      // se a página de fundo morrer logo após downloads.download().
      entry.canRestart = false;
      entry.message = t("handoffRestartRequested");
      await this.save();
      let id: number;
      try { id = await this.deps.startDownload(entry.url); } catch {
        entry.canRestart = true;
        entry.message = t("handoffRestartFailed");
        await this.save();
        return false;
      }
      this.ignoreIds.add(id);
      entry.state = "reiniciado_no_firefox";
      entry.message = t("handoffRestarted");
      await this.save();
      return true;
    } finally { this.inFlight.delete(entry.downloadId); }
  }
}
