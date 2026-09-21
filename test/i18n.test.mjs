import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { callHost } from "../dist/protocol.js";

const root = new URL("../", import.meta.url);
const read = path => readFileSync(new URL(path, root), "utf8");
const catalogs = Object.fromEntries(["en_US", "pt_BR", "es_ES"].map(locale =>
  [locale, JSON.parse(read(`static/_locales/${locale}/messages.json`))]));

test("three complete catalogs preserve substitutions and cover UI message references", () => {
  assert.equal(JSON.parse(read("static/manifest.json")).default_locale, "en_US");
  const keys = Object.keys(catalogs.en_US).sort();
  for (const catalog of Object.values(catalogs)) {
    assert.deepEqual(Object.keys(catalog).sort(), keys);
    for (const key of keys) {
      assert.ok(catalog[key].message.trim(), key);
      assert.deepEqual(catalog[key].placeholders, catalogs.en_US[key].placeholders, key);
      assert.deepEqual(catalog[key].message.match(/\$[A-Z0-9_]+\$/g)?.sort(),
        catalogs.en_US[key].message.match(/\$[A-Z0-9_]+\$/g)?.sort(), key);
    }
  }
  for (const dir of ["src", "static"]) {
    for (const file of readdirSync(new URL(dir + "/", root))) {
      if (!/\.(ts|html)$/.test(file)) continue;
      const text = read(`${dir}/${file}`);
      const pattern = file.endsWith(".html") ? /data-i18n="([^"]+)"/g : /\bt\("([^"]+)"/g;
      for (const match of text.matchAll(pattern)) {
        assert.ok(catalogs.en_US[match[1] ?? match[2]], `${file}: ${match[0]}`);
      }
    }
  }
});

test("native failures use the browser catalog, including unknown-code fallback", async () => {
  const previous = globalThis.browser;
  try {
    for (const locale of Object.keys(catalogs)) {
      globalThis.browser = { i18n: { getMessage: key => catalogs[locale][key]?.message ?? catalogs.en_US[key]?.message ?? "" } };
      for (const [code, key] of [["invalid_url", "errNativeUrl"], ["invalid_destination", "errNativeDestination"],
        ["app_unavailable", "errNativeApp"], ["unsupported_version", "errNativeVersion"],
        ["invalid_request", "errNativeRequest"], ["backend_error", "errNativeBackend"], ["future_code", "errUnknown"]]) {
        const result = await callHost(async () => ({ v: 1, request_id: "locale-test", ok: false,
          error: { code, message: "backend message in another language" } }), "locale-test", { op: "health" }, 1000);
        assert.equal(result.kind, "error");
        assert.equal(result.code, code);
        assert.equal(result.message, catalogs[locale][key].message);
      }
    }
  } finally { globalThis.browser = previous; }
});
