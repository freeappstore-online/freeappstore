/**
 * Security regression tests for the freeappstore store site.
 * Run with: node --test security.test.mjs
 * (Uses Node.js built-in test runner — zero dependencies.)
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// ── HTML escaping ──

function esc(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const XSS_PAYLOADS = [
  '<script>alert(1)</script>',
  '<img onerror=alert(1) src=x>',
  '"><svg onload=alert(1)>',
  '<iframe src="javascript:alert(1)">',
  '<a href="javascript:void(0)" onclick="alert(1)">',
  '${alert(1)}',
  '{{constructor.constructor("return this")()}}',
  '<details open ontoggle=alert(1)>',
  '<math><mtext><table><mglyph><style><!--</style><img src=x onerror=alert(1)>',
];

describe("HTML escaping covers all XSS payloads", () => {
  for (const payload of XSS_PAYLOADS) {
    it(`neutralizes: ${payload.slice(0, 50)}`, () => {
      const escaped = esc(payload);
      // No raw HTML tags should remain
      assert.ok(!/<[a-z]/i.test(escaped), `Raw HTML tag found in: ${escaped}`);
    });
  }
});

// ── search.js has esc() and uses it ──

describe("search.js security", () => {
  const searchJs = readFileSync("search.js", "utf-8");

  it("defines esc() function", () => {
    assert.ok(searchJs.includes("function esc(s)"), "search.js missing esc() function");
  });

  it("escapes item.name", () => {
    assert.ok(searchJs.includes("${esc(item.name)}"), "item.name not escaped");
  });

  it("escapes item.description", () => {
    assert.ok(searchJs.includes("${esc(item.description)}"), "item.description not escaped");
  });

  it("escapes item.iconBg", () => {
    assert.ok(searchJs.includes("${esc(item.iconBg)}"), "item.iconBg not escaped");
  });

  it("escapes item.icon", () => {
    assert.ok(searchJs.includes("${esc(item.icon)}"), "item.icon not escaped");
  });
});

// ── quality.js has esc() and uses it ──

describe("quality.js security", () => {
  const qualityJs = readFileSync("quality.js", "utf-8");

  it("defines esc() function", () => {
    assert.ok(qualityJs.includes("function esc(s)"), "quality.js missing esc() function");
  });

  it("escapes app names in summary", () => {
    assert.ok(qualityJs.includes("${esc(a.name"), "a.name not escaped in summary");
  });

  it("validates postMessage origin", () => {
    assert.ok(
      qualityJs.includes("e.origin !== expectedOrigin"),
      "postMessage handler missing origin check",
    );
  });
});

// ── dist/auth.js uses safe DOM APIs ──

describe("dist/auth.js security", () => {
  const authJs = readFileSync("dist/auth.js", "utf-8");

  it("does not use innerHTML with user data", () => {
    // The only innerHTML usages should be for static HTML entities (hamburger/close icons)
    const innerHtmlLines = authJs.split("\n").filter((l) => l.includes("innerHTML"));
    for (const line of innerHtmlLines) {
      assert.ok(
        line.includes("&#9776;") || line.includes("&#10005;"),
        `Suspicious innerHTML usage: ${line.trim()}`,
      );
    }
  });

  it("uses Bearer token auth (not cookies)", () => {
    assert.ok(authJs.includes("Bearer"), "Should use Bearer token auth");
  });

  it("uses /v1/auth/me endpoint", () => {
    assert.ok(authJs.includes("/v1/auth/me"), "Should use /v1/auth/me");
  });

  it("clears hash after OAuth callback", () => {
    assert.ok(authJs.includes("replaceState"), "Should clear hash via replaceState");
  });
});

// ── app-detail template has sandbox ──

describe("app-detail.html security", () => {
  const template = readFileSync("templates/app-detail.html", "utf-8");

  it("iframe has sandbox attribute", () => {
    assert.ok(template.includes('sandbox="allow-scripts allow-same-origin"'), "Missing sandbox on iframe");
  });

  it("iframe has referrerpolicy", () => {
    assert.ok(template.includes('referrerpolicy="no-referrer"'), "Missing referrerpolicy");
  });
});

// ── audit-fixture escapes reflected input ──

describe("audit-fixture security", () => {
  const fixture = readFileSync("audit-fixture/index.html", "utf-8");

  it("escapes scenario parameter before innerHTML", () => {
    assert.ok(
      fixture.includes("safeScenario") || fixture.includes("escapeHtml") || fixture.includes("replace(/</g"),
      "scenario parameter should be escaped before insertion",
    );
  });
});
