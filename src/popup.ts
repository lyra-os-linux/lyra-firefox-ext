import type { HostResult } from "./protocol.js";
import type { HandoffEntry } from "./handoff.js";
import type { Settings } from "./rules.js";
import { applyCaptureSettings, applyI18n, loadSettings, t } from "./settings.js";

applyI18n();

const toggle = document.getElementById("default-toggle") as HTMLInputElement;
const summary = document.getElementById("default-summary")!;
const toggleMessage = document.getElementById("toggle-message")!;
let current: Settings | undefined;

function describe(s: Settings): string {
  const where = s.scope === "all" ? t("summaryAllSites") : t("summaryListedSites", String(s.rules.length));
  const what = s.anyFileType ? t("summaryAnyType") : t("summaryListedTypes");
  return `${where} · ${what}`;
}

void loadSettings().then((s) => {
  current = s;
  toggle.checked = s.autoCapture;
  summary.textContent = describe(s);
});

// A permissão é pedida dentro do próprio clique (exigência do Firefox).
toggle.addEventListener("change", () => {
  if (!current) return;
  const next = { ...current, autoCapture: toggle.checked };
  if (next.autoCapture && next.scope === "listed" && next.rules.length === 0) {
    toggle.checked = false;
    toggleMessage.textContent = t("errNeedDomain");
    return;
  }
  void applyCaptureSettings(next).then((r) => {
    if (r.ok) {
      current = next;
      toggleMessage.textContent = next.autoCapture ? t("popupDefaultOn") : t("popupDefaultOff");
    } else {
      toggle.checked = current!.autoCapture;
      toggleMessage.textContent = r.message;
    }
  });
});

const statusEl = document.getElementById("status")!;
const detailEl = document.getElementById("status-detail")!;
const list = document.getElementById("entries")!;

async function refreshStatus(): Promise<void> {
  const res = (await browser.runtime.sendMessage({ type: "status" })) as HostResult;
  statusEl.classList.remove("ok", "bad");
  if (res.kind === "ok") {
    statusEl.textContent = t("statusConnected");
    statusEl.classList.add("ok");
    const b = res.result?.backend;
    detailEl.textContent = b?.engine_running ? "" : t("statusEngineStopped");
  } else {
    statusEl.textContent = t("statusUnavailable");
    statusEl.classList.add("bad");
    detailEl.textContent =
      res.kind === "host_missing" ? res.message : res.kind === "timeout" ? t("errTimeout") : res.message;
  }
}

async function refreshEntries(): Promise<void> {
  const entries = (await browser.runtime.sendMessage({ type: "entries" })) as HandoffEntry[];
  list.replaceChildren();
  document.getElementById("entries-section")!.hidden = entries.length === 0;
  const visible = entries.filter((e, i) => i < 5 || e.canRecover || e.canRestart);
  for (const e of visible) {
    const li = document.createElement("li");
    const name = document.createElement("strong");
    name.textContent = e.filename || e.url;
    name.title = e.url;
    const msg = document.createElement("p");
    msg.textContent = e.message;
    li.append(name, msg);
    if (e.canRestart || e.canRecover) {
      const b = document.createElement("button");
      b.textContent = e.canRecover ? t("recoverInFirefox") : t("restartInFirefox");
      b.addEventListener("click", async () => {
        b.disabled = true;
        try {
          await browser.runtime.sendMessage({ type: e.canRecover ? "recover" : "restart", requestId: e.requestId });
          await refreshEntries();
        } catch {
          msg.textContent = t("errRecovery");
        } finally { b.disabled = false; }
      });
      li.append(b);
    }
    list.append(li);
  }
}

document.getElementById("open-app")!.addEventListener("click", async () => {
  const res = (await browser.runtime.sendMessage({ type: "open-app" })) as HostResult;
  if (res.kind === "ok") window.close();
  else detailEl.textContent = res.kind === "timeout" ? t("errTimeout") : res.message;
});
document.getElementById("open-options")!.addEventListener("click", () => {
  void browser.runtime.openOptionsPage();
  window.close();
});

void refreshStatus();
void refreshEntries();
