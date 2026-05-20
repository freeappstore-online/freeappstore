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

test("cards have no inline style attribute; iconBg lives in card-styles.css", () => {
  const { tmp, tmpDist, registry } = runBuild();
  try {
    const indexHtml = readFileSync(join(tmpDist, "index.html"), "utf8");
    // No `style=` on the `.app-icon` div inside cards — the registry-driven
    // attack surface for inline styles is closed.
    assert.ok(
      !/<div class="app-icon" data-letter="[^"]*" style=/.test(indexHtml),
      "inline style= leaked onto .app-icon — registry → DOM inline-style vector is open",
    );
    // card-styles.css exists with a rule per app.
    const css = readFileSync(join(tmpDist, "card-styles.css"), "utf8");
    for (const app of registry.apps) {
      assert.ok(
        css.includes(`.app-card[data-id="${app.id}"] .app-icon`),
        `card-styles.css missing rule for id "${app.id}"`,
      );
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

// All CSP / security-header assertions read dist/_headers — the single
// HTTP-header source of truth. The <meta http-equiv> tag was removed in the
// "headers-only CSP" pass so we no longer test for it.
function readHeadersCsp(tmpDist) {
  const headers = readFileSync(join(tmpDist, "_headers"), "utf8");
  const line = (headers.match(/Content-Security-Policy:\s*([^\n]+)/) || [])[1] || '';
  return { headers, csp: line };
}

test("_headers ships X-Frame-Options DENY + frame-ancestors 'none' + HSTS + COOP", () => {
  const { tmp, tmpDist } = runBuild();
  try {
    const { headers, csp } = readHeadersCsp(tmpDist);
    assert.match(headers, /X-Frame-Options:\s*DENY/);
    assert.match(headers, /Strict-Transport-Security:\s*max-age=31536000/);
    assert.match(headers, /Cross-Origin-Opener-Policy:\s*same-origin/);
    assert.match(headers, /Referrer-Policy:\s*strict-origin-when-cross-origin/);
    assert.match(csp, /frame-ancestors 'none'/);
    assert.match(csp, /object-src 'none'/);
    assert.match(csp, /upgrade-insecure-requests/);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("style-src is locked (no 'unsafe-inline'), index.html has zero inline style=", () => {
  const { tmp, tmpDist } = runBuild();
  try {
    const { csp } = readHeadersCsp(tmpDist);
    const styleSrc = (csp.match(/style-src[^;]*/) || [''])[0];
    assert.ok(!styleSrc.includes("'unsafe-inline'"), `style-src still has 'unsafe-inline': ${styleSrc}`);
    const bodyHtml = readFileSync(join(tmpDist, "index.html"), "utf8").replace(/<head>[\s\S]*?<\/head>/, '');
    assert.ok(!/\sstyle="/.test(bodyHtml), `inline style= survived in body — would break locked-down CSP`);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("script-src has sha256 hash, no 'unsafe-inline', no build-time hosts", () => {
  const { tmp, tmpDist } = runBuild();
  try {
    const { csp } = readHeadersCsp(tmpDist);
    const scriptSrc = (csp.match(/script-src[^;]*/) || [''])[0];
    assert.ok(scriptSrc.includes("'sha256-"), `script-src must include a sha256 hash; got: ${scriptSrc}`);
    assert.ok(!scriptSrc.includes("'unsafe-inline'"), `script-src must not include 'unsafe-inline'; got: ${scriptSrc}`);
    assert.ok(!csp.includes("raw.githubusercontent.com"), "raw.githubusercontent.com leaked into runtime CSP");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("img-src and connect-src allowlist specific hostnames (no broad https:)", () => {
  const { tmp, tmpDist } = runBuild();
  try {
    const { csp } = readHeadersCsp(tmpDist);
    const imgSrc = (csp.match(/img-src[^;]*/) || [''])[0];
    assert.ok(!/https:\s*[;\s]/.test(imgSrc), `img-src should not allow blanket https:; got: ${imgSrc}`);
    assert.ok(imgSrc.includes('freeappstore.online'), `img-src missing primary store: ${imgSrc}`);
    const connectSrc = (csp.match(/connect-src[^;]*/) || [''])[0];
    assert.ok(connectSrc.includes('api.freeappstore.online'), `connect-src missing api: ${connectSrc}`);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("no <meta http-equiv=Content-Security-Policy> in index.html (headers only)", () => {
  const { tmp, tmpDist } = runBuild();
  try {
    const indexHtml = readFileSync(join(tmpDist, "index.html"), "utf8");
    assert.ok(
      !/meta\s+http-equiv="Content-Security-Policy"/i.test(indexHtml),
      "CSP meta tag re-appeared in index.html — headers should be the only source of truth",
    );
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("validator rejects duplicate ids and unbounded names", () => {
  // Duplicate id
  let r = runBuildWithRegistry([{ ...VALID_APP }, { ...VALID_APP }]);
  try {
    assert.equal(r.ok, false);
    assert.match(r.stderr, /duplicate id/);
  } finally { rmSync(r.tmp, { recursive: true, force: true }); }
  // 200-char name should be rejected (cap 80)
  r = runBuildWithRegistry([{ ...VALID_APP, name: "x".repeat(200) }]);
  try {
    assert.equal(r.ok, false);
    assert.match(r.stderr, /name must be 1-80 chars/);
  } finally { rmSync(r.tmp, { recursive: true, force: true }); }
  // Control char in name
  r = runBuildWithRegistry([{ ...VALID_APP, name: "evil name" }]);
  try {
    assert.equal(r.ok, false);
    assert.match(r.stderr, /name must be/);
  } finally { rmSync(r.tmp, { recursive: true, force: true }); }
});
