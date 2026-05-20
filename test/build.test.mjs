/**
 * Smoke test for build.js — verifies the storefront builder writes a
 * complete and XSS-safe index.html. Runs with Node's built-in test
 * runner so we don't add a vitest/jest dependency.
 *
 *   node --test test/build.test.mjs
 *   # or
 *   npm test
 *
 * Strategy: copy registry.json into a temp file, append a malicious
 * fixture app whose `description` contains a raw <script> payload, point
 * build.js at the temp registry + a temp dist dir via env vars, then
 * inspect the produced index.html and per-app detail page.
 *
 * The build hits external APIs (GitHub, freeappstore.online audit
 * endpoint, manifest.json per app) — all those calls degrade gracefully
 * to "no data" on failure, so the test runs cleanly offline / in CI.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(__filename), "..");
const BUILD_JS = join(REPO_ROOT, "build.js");
const REAL_REGISTRY = join(REPO_ROOT, "registry.json");

const XSS_PAYLOAD = "<script>alert(1)</script>";
const FIXTURE_ID = "xss-fixture";

function runBuild() {
  // Use a unique temp dir per run so parallel test invocations don't
  // collide. The temp dir is cleaned up after each test below.
  const tmp = mkdtempSync(join(tmpdir(), "fas-build-test-"));
  const tmpRegistry = join(tmp, "registry.json");
  const tmpDist = join(tmp, "dist");

  // Append the XSS fixture to a COPY of the real registry. We keep all
  // the real apps so the "every app id appears in index.html" assertion
  // is meaningful (not just covering the fixture).
  const realRegistry = JSON.parse(readFileSync(REAL_REGISTRY, "utf8"));
  // appUrl must match the validator's `https://*.freeappstore.online` rule
  // — use a fake subdomain. id has only lowercase + dashes so it passes
  // the ID_RE shape check.
  realRegistry.apps.push({
    id: "xss-fixture",
    name: "XSS Fixture",
    category: "learning",
    icon: "&#9888;",
    iconBg: "#fee2e2",
    description: XSS_PAYLOAD,
    appUrl: "https://xss-fixture.freeappstore.online",
    repo: "freeappstore-online/xss-fixture",
    cfProject: "xss-fixture",
    type: "standalone",
    developer: "FreeAppStore",
  });
  writeFileSync(tmpRegistry, JSON.stringify(realRegistry, null, 2));

  // Network calls inside build.js all degrade gracefully on failure;
  // both streams are suppressed so the test output stays readable
  // regardless of GitHub API rate-limit chatter. Build is ~5–10s wall
  // time when the GitHub API is reachable, faster when failures degrade
  // immediately to the cache fallback.
  execFileSync(process.execPath, [BUILD_JS], {
    env: {
      ...process.env,
      FAS_REGISTRY_PATH: tmpRegistry,
      FAS_DIST: tmpDist,
    },
    cwd: REPO_ROOT,
    stdio: ["ignore", "ignore", "ignore"],
    timeout: 60_000,
  });

  return { tmp, tmpDist, registry: realRegistry };
}

test("build.js writes index.html containing every app id", () => {
  const { tmp, tmpDist, registry } = runBuild();
  try {
    const indexHtml = readFileSync(join(tmpDist, "index.html"), "utf8");
    for (const app of registry.apps) {
      assert.ok(
        indexHtml.includes(`data-about="/apps/${app.id}"`),
        `index.html is missing app id "${app.id}"`,
      );
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("build.js escapes <script> payloads in app descriptions", () => {
  const { tmp, tmpDist } = runBuild();
  try {
    // Detail page is where `description` is rendered — that's the page
    // an attacker would target if the field weren't escaped.
    const detailHtml = readFileSync(
      join(tmpDist, "apps", `${FIXTURE_ID}.html`),
      "utf8",
    );

    // The literal escaped form must appear …
    assert.ok(
      detailHtml.includes("&lt;script&gt;alert(1)&lt;/script&gt;"),
      "expected escaped <script> payload in detail page; got:\n" +
        detailHtml.slice(0, 500),
    );

    // … and the raw executable form must NOT.
    assert.ok(
      !detailHtml.includes(XSS_PAYLOAD),
      "raw <script>alert(1)</script> leaked unescaped into detail page",
    );
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

// Helper: run build.js with a doctored registry, return {ok, stderr}.
function runBuildWithRegistry(apps) {
  const tmp = mkdtempSync(join(tmpdir(), "fas-build-validator-"));
  const tmpRegistry = join(tmp, "registry.json");
  const tmpDist = join(tmp, "dist");
  writeFileSync(tmpRegistry, JSON.stringify({ apps }, null, 2));
  try {
    execFileSync(process.execPath, [BUILD_JS], {
      env: { ...process.env, FAS_REGISTRY_PATH: tmpRegistry, FAS_DIST: tmpDist },
      cwd: REPO_ROOT,
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 60_000,
    });
    return { ok: true, stderr: "", tmp };
  } catch (err) {
    return {
      ok: false,
      stderr: (err.stderr && err.stderr.toString()) || err.message,
      tmp,
    };
  }
}

const VALID_APP = {
  id: "valid-app",
  name: "Valid",
  category: "learning",
  icon: "&#9728;",
  iconBg: "#eff6ff",
  description: "ok",
  appUrl: "https://valid.freeappstore.online",
  repo: "freeappstore-online/valid",
  cfProject: "valid",
  type: "standalone",
  developer: "FreeAppStore",
};

test("validator rejects non-https / wrong-host appUrl", () => {
  const { ok, stderr, tmp } = runBuildWithRegistry([
    { ...VALID_APP, appUrl: "https://evil.example.com" },
  ]);
  try {
    assert.equal(ok, false, "build should have failed");
    assert.match(stderr, /appUrl must be https:\/\/\*\.freeappstore\.online/);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("validator rejects bad iconBg (not a #hex color)", () => {
  const { ok, stderr, tmp } = runBuildWithRegistry([
    { ...VALID_APP, iconBg: "red; background: url(javascript:alert(1))" },
  ]);
  try {
    assert.equal(ok, false);
    assert.match(stderr, /iconBg must be a #hex color/);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("validator rejects bad id (uppercase / spaces / dots)", () => {
  for (const badId of ["UPPER", "two words", "dot.sep", ""]) {
    const { ok, tmp } = runBuildWithRegistry([{ ...VALID_APP, id: badId }]);
    try {
      assert.equal(ok, false, `id="${badId}" should have been rejected`);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  }
});

test("no inline onerror= attributes survive the build (data-letter pattern)", () => {
  const { tmp, tmpDist } = runBuild();
  try {
    const indexHtml = readFileSync(join(tmpDist, "index.html"), "utf8");
    assert.ok(
      !/\sonerror\s*=/i.test(indexHtml),
      "index.html still emits inline onerror= — the data-letter refactor regressed",
    );
    // data-letter attribute should be present on every app-icon
    assert.ok(
      /<div class="app-icon" data-letter="/.test(indexHtml),
      "expected at least one .app-icon with a data-letter attribute",
    );
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("CSP meta tag is present in index.html and _headers ships frame-ancestors", () => {
  const { tmp, tmpDist } = runBuild();
  try {
    const indexHtml = readFileSync(join(tmpDist, "index.html"), "utf8");
    assert.match(indexHtml, /Content-Security-Policy/);
    const headers = readFileSync(join(tmpDist, "_headers"), "utf8");
    assert.match(headers, /X-Frame-Options:\s*DENY/);
    assert.match(headers, /frame-ancestors 'none'/);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
