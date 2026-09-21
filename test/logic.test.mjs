// Testes da lógica pura da extensão (executados no Node contra o JS compilado).
import { test } from "node:test";
import assert from "node:assert/strict";

import { decide, extensionMatches, hostMatches, normalizeDomain, hostPatterns } from "../dist/rules.js";
import { RequestTracker } from "../dist/tracker.js";
import { callHost } from "../dist/protocol.js";
import { HandoffManager } from "../dist/handoff.js";

const OWN = "lyra-downloads@lyraos.com.br";
const settings = {
  autoCapture: true,
  scope: "listed",
  anyFileType: false,
  allowCookiesAll: false,
  showApp: true,
  rules: [{ domain: "example.org", allowCookies: false }, { domain: "cdn.test", allowCookies: true }],
  extensions: ["iso", "tar.gz"],
};
const item = (over = {}) => ({
  id: 1, url: "https://dl.example.org/a.iso?token=x", filename: "/home/u/Downloads/a.iso",
  incognito: false, state: "in_progress", ...over,
});
const rec = (over = {}) => ({
  url: "https://dl.example.org/a.iso?token=x", method: "GET", hasCookie: false,
  hasAuthorization: false, incognito: false, time: 0, ...over,
});

test("decisão: captura GET simples de domínio e tipo permitidos", () => {
  const d = decide(item(), settings, rec(), OWN);
  assert.equal(d.capture, true);
  assert.equal(d.url, "https://dl.example.org/a.iso?token=x", "URL assinada preservada");
});

test("decisão: tudo que é duvidoso fica no Firefox", () => {
  const cases = [
    [item(), { ...settings, autoCapture: false }, rec(), "desativada"],
    [item({ incognito: true }), settings, rec(), "privada"],
    [item({ url: "blob:https://example.org/uuid" }), settings, rec(), "http"],
    [item({ url: "data:application/octet-stream;base64,AA==" }), settings, rec(), "http"],
    [item({ url: "https://evil.test/a.iso" }), settings, rec(), "domínio"],
    [item({ filename: "/d/a.html" }), settings, rec(), "tipo"],
    [item(), settings, undefined, "informação"],
    [item(), settings, rec({ method: "POST" }), "POST"],
    [item(), settings, rec({ hasAuthorization: true }), "autenticação"],
    [item(), settings, rec({ hasCookie: true }), "cookies"],
    [item({ byExtensionId: OWN }), settings, rec(), "própria"],
    [item({ state: "complete" }), settings, rec(), "terminou"],
    [item({ url: "https://u:p@dl.example.org/a.iso" }), settings, rec(), "credenciais"],
  ];
  for (const [i, s, r, why] of cases) {
    const d = decide(i, s, r, OWN);
    assert.equal(d.capture, false, why);
    assert.match(d.reason, new RegExp(why, "i"));
  }
});

test("decisão: cookies aceitos só quando a regra permite", () => {
  const d = decide(item({ url: "https://x.cdn.test/a.iso" }), settings, rec({ url: "https://x.cdn.test/a.iso", hasCookie: true }), OWN);
  assert.equal(d.capture, true);
});

test("tipo de arquivo usa o nome definido pelo Firefox, inclusive extensões compostas", () => {
  assert.ok(extensionMatches("/tmp/download?id=3/pacote.tar.gz", ["tar.gz"]));
  assert.ok(!extensionMatches("/tmp/pacote.gz", ["tar.gz"]));
  assert.ok(extensionMatches("C:\\x\\A.ISO", ["iso"]));
});

test("domínios", () => {
  assert.ok(hostMatches("a.b.example.org", "example.org"));
  assert.ok(!hostMatches("badexample.org", "example.org"));
  assert.equal(normalizeDomain(" *.SourceForge.net. "), "sourceforge.net");
  assert.equal(normalizeDomain("http://x"), null);
  assert.deepEqual(hostPatterns([{ domain: "a.org", allowCookies: false }]), ["*://a.org/*", "*://*.a.org/*"]);
});

test("rastreador herda método em redirecionamentos e expira registros", () => {
  let now = 0;
  const t = new RequestTracker(() => now);
  t.record("r1", { url: "https://a.org/get", method: "POST", hasCookie: false, hasAuthorization: false, incognito: false });
  t.redirect("r1", "https://mirror.a.org/file.iso");
  assert.equal(t.find("https://mirror.a.org/file.iso").method, "POST");
  now = 3 * 60 * 1000;
  assert.equal(t.find("https://mirror.a.org/file.iso"), undefined);
});

test("protocolo: host ausente, erro, timeout e resposta de outra requisição", async () => {
  const missing = await callHost(() => Promise.reject(new Error("No such native application org.lyraos.downloads")), "r", { op: "health" }, 100);
  assert.equal(missing.kind, "host_missing");
  const err = await callHost(async () => ({ v: 1, request_id: "r", ok: false, error: { code: "invalid_url", message: "x" } }), "r", { op: "health" }, 100);
  assert.deepEqual([err.kind, err.code], ["error", "invalid_url"]);
  const slow = await callHost(() => new Promise(() => {}), "r", { op: "health" }, 20);
  assert.equal(slow.kind, "timeout");
  const other = await callHost(async () => ({ v: 1, request_id: "zzz", ok: true, result: {} }), "r", { op: "health" }, 100);
  assert.equal(other.kind, "error");
});

// ---- repasse -----------------------------------------------------------

function harness(script) {
  const log = [];
  const calls = [];
  let n = 0;
  const deps = {
    pause: async (id) => { log.push(`pause ${id}`); if (script.pauseFails) throw new Error("nope"); },
    resume: async (id) => { log.push(`resume ${id}`); if (script.resumeFails) throw new Error("nope"); },
    cancel: async (id) => { log.push(`cancel ${id}`); if (script.cancelFails) throw new Error("nope"); },
    erase: async (id) => { log.push(`erase ${id}`); },
    startDownload: async (url) => { log.push(`start ${url}`); return 99; },
    getDownload: async () => script.currentDownload,
    call: async (rid, op) => {
      calls.push([rid, op.op]);
      const r = script.responses.shift();
      return typeof r === "function" ? r(rid, op) : r;
    },
    newId: () => `req-${++n}`,
    now: () => 1000,
    changed: () => {},
  };
  return { m: new HandoffManager(deps), log, calls };
}
const revoked = { kind: "ok", result: { revoked: true, completed: false } };
const accepted = { kind: "ok", result: { status: "accepted", task: { task_id: "t1" } } };

test("repasse aceito: pausa, confirma, só então cancela e apaga", async () => {
  const h = harness({ responses: [accepted] });
  const e = await h.m.handoff(item());
  assert.equal(e.state, "repassado");
  assert.deepEqual(h.log, ["pause 1", "cancel 1", "erase 1"]);
  assert.ok(h.m.isGuarded(item()), "mesmo download não é reprocessado");
});

test("recusa do backend: download retomado no Firefox, nada cancelado", async () => {
  const h = harness({ responses: [{ kind: "error", code: "invalid_url", message: "inválido" }] });
  const e = await h.m.handoff(item());
  assert.equal(e.state, "mantido_no_firefox");
  assert.deepEqual(h.log, ["pause 1", "resume 1"]);
});

test("host ausente: retoma no Firefox e explica", async () => {
  const h = harness({ responses: [{ kind: "host_missing", message: "não instalado" }] });
  const e = await h.m.handoff(item());
  assert.equal(e.state, "mantido_no_firefox");
  assert.match(e.message, /não instalado/);
});

test("timeout seguido de aceite no reenvio com o MESMO request_id", async () => {
  const h = harness({ responses: [{ kind: "timeout" }, accepted] });
  const e = await h.m.handoff(item());
  assert.equal(e.state, "repassado");
  assert.equal(h.calls[0][0], h.calls[1][0], "reenvio usa o mesmo request_id (idempotente)");
});

test("timeout duplo: desiste no backend (cancel_handoff) e retoma no Firefox", async () => {
  const h = harness({ responses: [{ kind: "timeout" }, { kind: "timeout" }, revoked] });
  const e = await h.m.handoff(item());
  assert.deepEqual(h.calls.map((c) => c[1]), ["handoff", "handoff", "cancel_handoff"]);
  assert.equal(e.state, "mantido_no_firefox");
  assert.ok(!h.log.includes("cancel 1"));
});

test("download que não pausa não é repassado (evita duas transferências)", async () => {
  const h = harness({ pauseFails: true, responses: [] });
  const e = await h.m.handoff(item());
  assert.equal(e.state, "mantido_no_firefox");
  assert.equal(h.calls.length, 0, "nada enviado ao Lyra");
});

test("falha ao cancelar após aceite: cópia fica pausada e o usuário é avisado", async () => {
  const h = harness({ cancelFails: true, responses: [accepted] });
  const e = await h.m.handoff(item());
  assert.equal(e.state, "pausado_no_firefox");
});

test("falha ao retomar: oferece reinício explícito, protegido contra recaptura", async () => {
  const h = harness({ resumeFails: true, responses: [{ kind: "error", code: "invalid_url", message: "x" }] });
  const e = await h.m.handoff(item());
  assert.equal(e.state, "parado_no_firefox");
  assert.equal(e.canRestart, true);
  assert.ok(await h.m.restartInFirefox(e.requestId));
  assert.equal(e.state, "reiniciado_no_firefox");
  // O download reiniciado (novo id, mesma URL) não é capturado de novo.
  assert.ok(h.m.isGuarded(item({ id: 99 })));
  assert.ok(h.m.isGuarded(item({ id: 123 })), "URL protegida mesmo antes de saber o novo id");
  assert.equal(await h.m.restartInFirefox(e.requestId), false, "reinício não se repete");
});

test("resposta repetida/atrasada não altera um repasse já finalizado", async () => {
  const h = harness({ responses: [accepted] });
  const e = await h.m.handoff(item());
  // Simula uma finalização tardia (ex.: segunda resposta): o estado não muda.
  await h.m["finish"](e, "mantido_no_firefox", "tarde demais");
  assert.equal(e.state, "repassado");
});

test("modo gerenciador padrão: todos os sites e qualquer tipo, mantendo as salvaguardas", () => {
  const all = { ...settings, scope: "all", anyFileType: true };
  const other = { url: "https://qualquer.site/baixar?id=9", filename: "/d/relatorio.pdf" };
  assert.equal(decide(item(other), all, rec({ url: other.url }), OWN).capture, true);
  assert.equal(decide(item(other), all, rec({ url: other.url, hasCookie: true }), OWN).capture, false, "cookies: fica no Firefox por padrão");
  assert.equal(decide(item(other), { ...all, allowCookiesAll: true }, rec({ url: other.url, hasCookie: true }), OWN).capture, true);
  assert.equal(decide(item({ ...other, incognito: true }), all, rec({ url: other.url }), OWN).capture, false);
  assert.equal(decide(item(other), all, rec({ url: other.url, method: "POST" }), OWN).capture, false);
  assert.equal(decide(item(other), { ...all, autoCapture: false }, rec({ url: other.url }), OWN).capture, false, "desligado por padrão");
});

test("cancelamento incerto nunca retoma o Firefox, inclusive resposta de backend antigo", async () => {
  for (const cancellation of [
    { kind: "timeout" }, { kind: "host_missing", message: "ausente" },
    { kind: "error", code: "backend_error", message: "erro" },
    { kind: "ok", result: { found: false, cancelled: false } },
    { kind: "ok", result: { revoked: true } },
  ]) {
    const h = harness({ responses: [{ kind: "timeout" }, { kind: "timeout" }, cancellation] });
    const e = await h.m.handoff(item());
    assert.equal(e.state, "repasse_incerto");
    assert.equal(e.canRecover, true);
    assert.equal(e.canRestart, false);
    assert.deepEqual(h.log, ["pause 1"]);
  }
});

test("falha de transporte depois do aceite exige reconciliação", async () => {
  const h = harness({ responses: [{ kind: "error", code: "host_failed", message: "resposta perdida" }, revoked] });
  await h.m.handoff(item());
  assert.deepEqual(h.calls.map((c) => c[1]), ["handoff", "cancel_handoff"]);
  assert.deepEqual(h.log, ["pause 1", "resume 1"]);
});

test("host ausente no reenvio não prova que a primeira tentativa falhou", async () => {
  const h = harness({ responses: [{ kind: "timeout" }, { kind: "host_missing", message: "ausente" }, { kind: "timeout" }] });
  const e = await h.m.handoff(item());
  assert.equal(e.state, "repasse_incerto");
  assert.deepEqual(h.log, ["pause 1"]);
});

test("recuperação restaurada confirma revogação antes de retomar", async () => {
  const h = harness({ responses: [{ kind: "timeout" }, { kind: "timeout" }, { kind: "timeout" }] });
  const e = await h.m.handoff(item());
  const next = harness({ responses: [revoked] });
  next.m.restore(h.m.snapshot());
  assert.ok(next.m.isGuarded(item()));
  assert.equal(next.m.entries[0].canRecover, true);
  assert.ok(await next.m.recoverInFirefox(e.requestId));
  assert.deepEqual(next.calls, [[e.requestId, "cancel_handoff"]]);
  assert.deepEqual(next.log, ["resume 1"]);
});

test("download já concluído no Lyra cancela somente a cópia do Firefox", async () => {
  const h = harness({ responses: [{ kind: "timeout" }, { kind: "timeout" }, { kind: "ok", result: { revoked: true, completed: true } }] });
  const e = await h.m.handoff(item());
  assert.equal(e.state, "repassado");
  assert.deepEqual(h.log, ["pause 1", "cancel 1", "erase 1"]);
});

test("queda após aceite persistido não cancela a tarefa entregue ao Lyra", async () => {
  const h = harness({ responses: [] });
  h.m.restore({ entries: [{ requestId: "accepted", downloadId: 1, url: item().url, filename: "a.iso", state: "enviando", accepted: true, message: "", time: 1, canRestart: false }] });
  assert.ok(await h.m.recoverInFirefox("accepted"));
  assert.deepEqual(h.calls, []);
  assert.deepEqual(h.log, ["cancel 1", "erase 1"]);
});

test("restaura entradas legadas e protege o reinício contra suspensão e clique duplo", async () => {
  const h = harness({ responses: [] });
  h.m.restore({ entries: [{ requestId: "legacy", downloadId: 1, url: item().url, filename: "a.iso", state: "parado_no_firefox", message: "", time: 1, canRestart: true }] });
  const results = await Promise.all([h.m.restartInFirefox("legacy"), h.m.restartInFirefox("legacy")]);
  assert.deepEqual(results, [true, false]);
  const next = harness({ responses: [] });
  next.m.restore(h.m.snapshot());
  assert.ok(next.m.isGuarded(item({ id: 99 })));
  assert.ok(next.m.isGuarded(item({ id: 123 })));
  assert.equal(await next.m.restartInFirefox("legacy"), false);
});

test("entradas em andamento sobrevivem a uma nova página de fundo", async () => {
  const h = harness({ responses: [revoked] });
  h.m.restore({ entries: [{ requestId: "pending", downloadId: 1, url: item().url, filename: "a.iso", state: "enviando", message: "", time: 1, canRestart: false }] });
  assert.equal(h.m.entries[0].state, "repasse_incerto");
  await h.m.recoverInFirefox("pending");
  assert.deepEqual(h.log, ["resume 1"]);
});

test("histórico cheio não descarta repasses que precisam de recuperação", async () => {
  const h = harness({ responses: Array.from({ length: 66 }, () => ({ kind: "timeout" })) });
  for (let id = 1; id <= 22; id++) await h.m.handoff(item({ id }));
  assert.equal(h.m.entries.length, 22);
  assert.ok(h.m.entries.every((e) => e.canRecover));
});

test("protocolo rejeita sucesso sem correlação e captura exceção síncrona do host", async () => {
  const bad = await callHost(async () => ({ v: 1, request_id: null, ok: true }), "r", { op: "health" }, 100);
  assert.equal(bad.kind, "error");
  const failed = await callHost(() => { throw new Error("host exited"); }, "r", { op: "health" }, 100);
  assert.equal(failed.kind, "error");
});

test("restaurar após uma retomada já aplicada não oferece download duplicado", async () => {
  const h = harness({ responses: [revoked], resumeFails: true, currentDownload: { state: "in_progress", paused: false } });
  h.m.restore({ entries: [{ requestId: "resumed", downloadId: 1, url: item().url, filename: "a.iso", state: "enviando", message: "", time: 1, canRestart: false }] });
  await h.m.recoverInFirefox("resumed");
  assert.equal(h.m.entries[0].state, "mantido_no_firefox");
  assert.equal(h.m.entries[0].canRestart, false);
});

test("falha de persistência antes do repasse deixa a transferência original intacta", async () => {
  const calls = [];
  const m = new HandoffManager({
    pause: async () => { calls.push("pause"); }, resume: async () => {}, cancel: async () => {}, erase: async () => {},
    startDownload: async () => 1, getDownload: async () => undefined,
    call: async () => { calls.push("handoff"); return accepted; },
    newId: () => "storage-failure", now: () => 0,
    changed: async () => { throw new Error("storage unavailable"); },
  });
  await assert.rejects(m.handoff(item()), /storage unavailable/);
  assert.deepEqual(calls, []);
});

test("late HTTP metadata wakes waiting downloads without weakening capture rules", async () => {
  for (const overrides of [{}, {method: "POST"}, {hasCookie: true}, {hasAuthorization: true}]) {
    const tracker = new RequestTracker();
    const pending = tracker.waitFor(item().url, 100);
    tracker.record("late", rec(overrides));
    const observed = await pending;
    assert.ok(observed);
    assert.equal(decide(item(), settings, observed, OWN).capture, Object.keys(overrides).length === 0);
  }
});

test("late redirects preserve original method; missing metadata still refuses capture", async () => {
  const tracker = new RequestTracker();
  tracker.record("redirect", rec({url: "https://example.org/form", method: "POST"}));
  const pending = tracker.waitFor(item().url, 100);
  tracker.redirect("redirect", item().url);
  assert.equal(decide(item(), settings, await pending, OWN).capture, false);
  const unknown = new RequestTracker();
  assert.equal(await unknown.waitFor(item().url, 5), undefined);
  assert.equal(decide(item(), settings, unknown.find(item().url), OWN).capture, false);
  const afterTimeout = unknown.waitFor(item().url, 100);
  unknown.record("later", rec());
  assert.equal((await afterTimeout).method, "GET");
});
