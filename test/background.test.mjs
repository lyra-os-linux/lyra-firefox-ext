import { test } from "node:test";
import assert from "node:assert/strict";

test("UI aguarda leitura da sessão e recupera entrada ao recriar o background", async () => {
  const event = () => ({ addListener(fn) { this.fn = fn; }, hasListener() { return false; } });
  let release;
  const saved = new Promise((resolve) => { release = resolve; });
  const actions = [];
  const writes = [];
  globalThis.browser = {
    storage: { onChanged: event(), local: { get: async () => ({}) }, session: {
      get: () => saved, set: async (value) => { writes.push(structuredClone(value)); },
    } },
    runtime: { id: "lyra-downloads@lyraos.com.br", onInstalled: event(), onStartup: event(), onMessage: event() },
    menus: { onClicked: event() }, permissions: { onAdded: event() },
    downloads: { onCreated: event(), search: async () => [], download: async () => { actions.push("restart"); return 22; } },
    action: { setBadgeText: async () => {}, setBadgeBackgroundColor: async () => {} },
  };
  await import("../dist/background.js?restore-test");
  const send = (msg) => browser.runtime.onMessage.fn(msg, { id: browser.runtime.id });
  let replied = false;
  const pending = send({ type: "entries" }).then((entries) => { replied = true; return entries; });
  await Promise.resolve();
  assert.equal(replied, false);
  release({ entries: [{ requestId: "saved", downloadId: 1, url: "https://example.org/a.iso", filename: "a.iso", state: "parado_no_firefox", message: "retry", time: 1, canRestart: true }] });
  assert.equal((await pending)[0].requestId, "saved");
  assert.equal(await send({ type: "restart", requestId: "saved" }), true);
  assert.deepEqual(actions, ["restart"]);
  assert.equal(writes.at(-1).handoff.entries[0].state, "reiniciado_no_firefox");
  assert.equal(writes[0].handoff.entries[0].canRestart, false, "persiste antes do efeito externo");
});
