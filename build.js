const fs = require('fs');
const path = require('path');
const https = require('https');

const ROOT = __dirname;
const DIST = path.join(ROOT, 'dist');

// Read registry
const registry = JSON.parse(fs.readFileSync(path.join(ROOT, 'registry.json'), 'utf8'));
const apps = registry.apps;

// Read templates
const indexTemplate = fs.readFileSync(path.join(ROOT, 'templates', 'index.html'), 'utf8');
const detailTemplate = fs.readFileSync(path.join(ROOT, 'templates', 'app-detail.html'), 'utf8');

// Helper: format category label (brain-training -> Brain Training)
function categoryLabel(cat) {
  return cat.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

// Helper: type label
function typeLabel(type) {
  return type === 'standalone' ? 'Standalone (works offline)' : 'Connected (requires internet)';
}

// --- GitHub API helpers (used to source first-published + commit log) ---

const GH_TOKEN = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '';

function ghFetch(urlPath) {
  return new Promise((resolve, reject) => {
    const headers = {
      'User-Agent': 'freeappstore-build',
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    };
    if (GH_TOKEN) headers['Authorization'] = `Bearer ${GH_TOKEN}`;
    const req = https.request(
      { hostname: 'api.github.com', path: urlPath, method: 'GET', headers },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            try { resolve(JSON.parse(data)); }
            catch (e) { reject(new Error(`bad JSON from ${urlPath}: ${e.message}`)); }
          } else {
            // Non-fatal — caller should fall back to "no data" rather than fail the build.
            // Surface the rate-limit case clearly.
            const isRateLimit = res.statusCode === 403 && /rate limit/i.test(data);
            reject(new Error(`${urlPath} → ${res.statusCode}${isRateLimit ? ' (rate limited)' : ''}`));
          }
        });
      },
    );
    req.on('error', reject);
    req.end();
  });
}

const FMT_DATE = new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
const FMT_SHORT = new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'short', day: 'numeric' });

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Trim the GitHub API responses to only the fields renderHistorySection
 * and renderPublishedLine actually read. The full responses are ~14 KB
 * per app × 25 apps ≈ 350 KB; the trimmed shape is ~600 bytes per app.
 * Smaller cache = smaller diffs in CI commits = less repo churn.
 */
function compactHistory(meta, commits) {
  return {
    meta: meta
      ? {
          created_at: meta.created_at ?? null,
          pushed_at: meta.pushed_at ?? null,
        }
      : null,
    commits: Array.isArray(commits)
      ? commits.map((c) => ({
          sha: c.sha,
          html_url: c.html_url,
          commit: {
            message: c.commit?.message ?? '',
            author: { date: c.commit?.author?.date ?? c.commit?.committer?.date ?? null },
          },
        }))
      : null,
  };
}

async function fetchAppHistory(repo) {
  // repo is "owner/name". Two parallel calls: repo metadata for created_at,
  // and the last 3 commits for the changelog. Failures degrade gracefully.
  try {
    const [meta, commits] = await Promise.all([
      ghFetch(`/repos/${repo}`),
      ghFetch(`/repos/${repo}/commits?per_page=3`),
    ]);
    return compactHistory(meta, commits);
  } catch (err) {
    console.warn(`  ! could not fetch history for ${repo}: ${err.message}`);
    return { meta: null, commits: null };
  }
}

// --- History cache (data/commit-history.json) ---
//
// CF Pages runs its own GitHub-integration build that doesn't have
// GITHUB_TOKEN, so it hits the 60/hr unauthenticated rate limit and
// renders the fallback. Caching the histories in the repo lets that
// no-token build still produce correct output — it falls back to the
// cache when the API call fails. The scheduled GH-Actions deploy
// refreshes the cache every 6h.
const CACHE_PATH = path.join(ROOT, 'data', 'commit-history.json');

function readCache() {
  try {
    return JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8'));
  } catch {
    return {};
  }
}

function writeCache(cache) {
  fs.mkdirSync(path.dirname(CACHE_PATH), { recursive: true });
  fs.writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2) + '\n');
}

/**
 * Fetch history for every app, falling back to the cache when GitHub
 * fails. Returns the histories array AND the updated cache (callers
 * write it to disk so the next build sees fresh data even if the API
 * is rate-limited at that time).
 */
async function fetchAllHistories(apps) {
  const cache = readCache();
  const histories = await Promise.all(
    apps.map(async (app) => {
      const fresh = await fetchAppHistory(app.repo);
      if (fresh.commits) {
        // Cache is keyed by repo so re-ordering registry doesn't churn.
        cache[app.repo] = fresh;
        return fresh;
      }
      // API failed — return the last good data, if any.
      const cached = cache[app.repo];
      if (cached?.commits) return cached;
      return fresh; // both null
    }),
  );
  writeCache(cache);
  return histories;
}

function renderHistorySection(repo, history) {
  const githubAllUrl = `https://github.com/${repo}/commits/main`;
  if (!history.commits || history.commits.length === 0) {
    return `<section class="app-section">
      <h2>Recent updates</h2>
      <p style="color: var(--muted);">No updates yet — check back after the first deploy.</p>
      <p><a class="source-link" href="${githubAllUrl}" target="_blank" rel="noopener">See full history on GitHub &rarr;</a></p>
    </section>`;
  }
  const items = history.commits.map((c) => {
    const date = new Date(c.commit.author?.date ?? c.commit.committer?.date);
    const isoDate = date.toISOString().slice(0, 10);
    const shortDate = FMT_SHORT.format(date);
    // Commit messages are user-provided — escape and trim to first line.
    const firstLine = (c.commit.message || '').split('\n')[0].trim();
    const msg = escapeHtml(firstLine).slice(0, 140);
    const sha = c.sha.slice(0, 7);
    return `<li class="version-row">
      <time datetime="${isoDate}" class="version-date">${shortDate}</time>
      <span class="version-msg">${msg}</span>
      <a class="version-sha" href="${c.html_url}" target="_blank" rel="noopener">${sha}</a>
    </li>`;
  }).join('\n');
  return `<section class="app-section">
      <h2>Recent updates</h2>
      <ul class="version-log">
${items}
      </ul>
      <p style="margin-top: 0.75rem;"><a class="source-link" href="${githubAllUrl}" target="_blank" rel="noopener">See full history on GitHub &rarr;</a></p>
    </section>`;
}

function renderPublishedLine(history) {
  if (!history.meta) return '';
  const created = history.meta.created_at ? new Date(history.meta.created_at) : null;
  const lastCommit = history.commits?.[0];
  const updated = lastCommit?.commit?.author?.date
    ? new Date(lastCommit.commit.author.date)
    : history.meta.pushed_at ? new Date(history.meta.pushed_at) : null;
  const parts = [];
  if (created) {
    parts.push(`First published <time datetime="${created.toISOString().slice(0,10)}">${FMT_DATE.format(created)}</time>`);
  }
  if (updated) {
    parts.push(`last updated <time datetime="${updated.toISOString().slice(0,10)}">${FMT_DATE.format(updated)}</time>`);
  }
  if (parts.length === 0) return '';
  return `<p class="published-line">${parts.join(' &middot; ')}</p>`;
}

// Ensure dist directories exist
fs.mkdirSync(path.join(DIST, 'apps'), { recursive: true });

// --- Generate index.html ---

// Build filter buttons
const categories = [...new Set(apps.map(a => a.category))];
const filterButtons = [
  '<button class="filter-btn active" data-filter="all">All</button>',
  ...categories.map(cat =>
    `<button class="filter-btn" data-filter="${cat}">${categoryLabel(cat)}</button>`
  )
].join('\n        ');

// Build app cards
const appCards = apps.map(app => {
  return `        <div class="app-card" data-category="${app.category}" data-about="/apps/${app.id}.html">
          <div class="app-card-header">
            <div class="app-icon" style="background: ${app.iconBg};">${app.icon}</div>
            <div>
              <h3>${app.name}</h3>
              <div class="tag">${categoryLabel(app.category)}</div>
            </div>
          </div>
          <p>${app.description}</p>
          <div class="app-actions"><a href="${app.appUrl}" target="_blank" rel="noopener" class="app-btn-open">Open</a><a href="" class="app-link app-about">About &rarr;</a></div>
        </div>`;
}).join('\n\n');

// indexHtml is finalized inside the async IIFE below — cross-store
// registry fetch is async, and we want to embed it into the page.
let indexHtml = indexTemplate
  .replace('{{FILTER_BUTTONS}}', filterButtons)
  .replace('{{APPS_GRID}}', appCards);

// --- Generate app detail pages ---
// Fetch histories in parallel — 26 apps × 2 calls = 52 requests, well under
// authenticated GitHub rate limits (5000/hr) and ~5–10s wall time.
// Wrapped in async IIFE because this file is CJS (no top-level await).

async function fetchAuditSummary() {
  // Fetch the latest audit summary from /v1/audit. Failures degrade
  // gracefully — the audit badge just doesn't render. Falls back to
  // an empty map so all apps render the "not yet audited" state.
  try {
    const res = await new Promise((resolve, reject) => {
      const req = https.request(
        { hostname: 'api.freeappstore.online', path: '/v1/audit?store=apps', method: 'GET' },
        (r) => {
          let data = '';
          r.on('data', (c) => (data += c));
          r.on('end', () => resolve({ status: r.statusCode, body: data }));
        },
      );
      req.on('error', reject);
      req.end();
    });
    if (res.status !== 200) return new Map();
    const parsed = JSON.parse(res.body);
    const map = new Map();
    for (const s of parsed.summary ?? []) map.set(s.appId, s);
    return map;
  } catch (err) {
    console.warn(`  ! could not fetch audit summary: ${err.message}`);
    return new Map();
  }
}

function renderAuditBadge(summary) {
  if (!summary) {
    return '<p class="audit-badge audit-pending"><span class="dot"></span> Not yet audited</p>';
  }
  const total = summary.pass + summary.warn + summary.fail;
  if (summary.fail > 0) {
    return `<p class="audit-badge audit-fail"><span class="dot"></span> ${summary.fail} compliance failure${summary.fail === 1 ? '' : 's'} of ${total} checks &middot; <a href="https://api.freeappstore.online/v1/audit?app=${summary.appId}">details</a></p>`;
  }
  if (summary.warn > 0) {
    return `<p class="audit-badge audit-warn"><span class="dot"></span> ${summary.pass}/${total} compliance checks pass &middot; ${summary.warn} warning${summary.warn === 1 ? '' : 's'}</p>`;
  }
  return `<p class="audit-badge audit-pass"><span class="dot"></span> ${total}/${total} compliance checks pass</p>`;
}

/**
 * Per-app PWA manifest fetch. Used at build time to read the
 * `orientation` + `min_viewport_width` declarations and render the
 * coverage badge on detail pages. Failures → null (badge shows
 * "viewport support unknown" placeholder).
 *
 * Each call is one HTTPS request to {appUrl}/manifest.json. With ~30
 * apps the total is well within rate limits.
 */
function fetchManifest(appUrl) {
  return new Promise((resolve) => {
    try {
      const u = new URL('/manifest.json', appUrl);
      const req = https.request(
        { hostname: u.hostname, path: u.pathname, method: 'GET' },
        (r) => {
          let data = '';
          r.on('data', (c) => (data += c));
          r.on('end', () => {
            if (r.statusCode !== 200) return resolve(null);
            try {
              resolve(JSON.parse(data));
            } catch {
              resolve(null);
            }
          });
        },
      );
      req.on('error', () => resolve(null));
      req.setTimeout(6000, () => {
        req.destroy();
        resolve(null);
      });
      req.end();
    } catch {
      resolve(null);
    }
  });
}

/**
 * Map a min_viewport_width (CSS px) to the rough share of devices that
 * have viewports at least that wide. Numbers come from StatCounter
 * device-share + common-resolution data; this is a directional
 * estimate, not a precision claim — the badge says "approx".
 *
 * Lower min_viewport_width → wider device coverage.
 */
function viewportCoverage(minWidth) {
  if (minWidth <= 320) return 99;
  if (minWidth <= 360) return 96;
  if (minWidth <= 414) return 88;
  if (minWidth <= 600) return 60;
  if (minWidth <= 768) return 35;
  if (minWidth <= 1024) return 20;
  return 10;
}

function renderViewportBadge(manifest) {
  if (!manifest) {
    return '<p class="audit-badge audit-pending"><span class="dot"></span> Viewport support: unknown</p>';
  }
  const orientation = typeof manifest.orientation === 'string' ? manifest.orientation : null;
  const minWidth =
    typeof manifest.min_viewport_width === 'number' ? manifest.min_viewport_width : null;
  if (orientation === null || minWidth === null) {
    return '<p class="audit-badge audit-pending"><span class="dot"></span> Viewport support: not declared</p>';
  }
  const coverage = viewportCoverage(minWidth);
  const orientLabel =
    orientation === 'any'
      ? 'portrait + landscape'
      : orientation === 'portrait' || orientation === 'portrait-primary'
        ? 'portrait only'
        : 'landscape only';
  // Color band: ≥90 green, ≥50 amber, <50 red.
  const cls = coverage >= 90 ? 'audit-pass' : coverage >= 50 ? 'audit-warn' : 'audit-fail';
  return `<p class="audit-badge ${cls}"><span class="dot"></span> Works on ~${coverage}% of devices · ${orientLabel} · min ${minWidth}px wide</p>`;
}

async function fetchCrossStoreRegistry() {
  // Pull the OTHER store's registry so the homepage search can
  // federate. Failure → empty registry, search still works locally.
  return new Promise((resolve) => {
    const req = https.request(
      {
        hostname: 'raw.githubusercontent.com',
        path: '/freegamestore-online/freegamestore/main/registry.json',
        method: 'GET',
      },
      (r) => {
        let data = '';
        r.on('data', (c) => (data += c));
        r.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            resolve({
              items: parsed.games ?? [],
              domain: 'freegamestore.online',
              path: 'games',
            });
          } catch {
            resolve({ items: [], domain: 'freegamestore.online', path: 'games' });
          }
        });
      },
    );
    req.on('error', () => resolve({ items: [], domain: 'freegamestore.online', path: 'games' }));
    req.end();
  });
}

(async () => {
console.log(`Fetching commit history for ${apps.length} apps (with disk cache fallback)...`);
const [histories, auditMap, crossRegistry, manifests] = await Promise.all([
  fetchAllHistories(apps),
  fetchAuditSummary(),
  fetchCrossStoreRegistry(),
  Promise.all(apps.map((a) => fetchManifest(a.appUrl))),
]);

// Now finalize and write the index page with the embedded cross-store
// registry so the search bar can federate.
indexHtml = indexHtml.replace(
  '{{CROSS_STORE_REGISTRY}}',
  JSON.stringify(crossRegistry).replace(/</g, '\\u003c'),
);
fs.writeFileSync(path.join(DIST, 'index.html'), indexHtml);

// --- Quality Dashboard ---
// Embeds both the local apps registry and the cross-store games registry
// so visitors can audit either from one page. The page is mostly static —
// the live iframe + postMessage logic lives in /quality.js.
const qualityTemplate = fs.readFileSync(path.join(ROOT, 'templates', 'quality.html'), 'utf8');
const qualityRegistry = {
  apps: apps.map(a => ({ id: a.id, name: a.name, appUrl: a.appUrl })),
  games: (crossRegistry.items || []).map(g => ({ id: g.id, name: g.name, appUrl: g.appUrl })),
  // Platform fixtures — deliberately-broken control cases used to verify
  // the auditor flags each layout-bug class correctly. Visible from the
  // /quality dashboard but filtered out of the main store browse.
  fixtures: [
    { id: 'auditor-fixture', name: 'Auditor Fixture', appUrl: '/audit-fixture/', fixture: true,
      description: 'Deliberately-broken control cases. Each scenario reproduces a known layout bug to verify the platform auditor flags it correctly.' },
  ],
};
const qualityHtml = qualityTemplate.replace(
  '{{REGISTRIES_JSON}}',
  JSON.stringify(qualityRegistry).replace(/</g, '\\u003c'),
);
fs.writeFileSync(path.join(DIST, 'quality.html'), qualityHtml);
console.log(`  /quality dashboard generated for ${qualityRegistry.apps.length} apps + ${qualityRegistry.games.length} games`);
console.log(`  ${crossRegistry.items.length} games available for cross-store search`);
// Summarize: count how many apps got real commit data vs fell back.
const okCount = histories.filter((h) => Array.isArray(h?.commits) && h.commits.length > 0).length;
console.log(`  ${okCount}/${apps.length} apps got commit history`);
console.log(`  ${auditMap.size} apps have audit results`);

apps.forEach((app, i) => {
  const offline = app.type === 'standalone' ? 'Yes' : 'When cached';
  const account = app.type === 'standalone' ? 'Not required' : 'Not required';
  const history = histories[i];

  let html = detailTemplate
    .replace(/\{\{NAME\}\}/g, app.name)
    .replace(/\{\{NAME_LOWER\}\}/g, app.name.toLowerCase())
    .replace(/\{\{ID\}\}/g, app.id)
    .replace(/\{\{ICON\}\}/g, app.icon)
    .replace(/\{\{ICON_BG\}\}/g, app.iconBg)
    .replace(/\{\{CATEGORY_LABEL\}\}/g, categoryLabel(app.category))
    .replace(/\{\{DESCRIPTION\}\}/g, app.description)
    .replace(/\{\{APP_URL\}\}/g, app.appUrl)
    .replace(/\{\{REPO\}\}/g, app.repo)
    .replace(/\{\{TYPE_LABEL\}\}/g, typeLabel(app.type))
    .replace(/\{\{DEVELOPER\}\}/g, app.developer)
    .replace(/\{\{OFFLINE\}\}/g, offline)
    .replace(/\{\{ACCOUNT\}\}/g, account)
    .replace(/\{\{PUBLISHED_LINE\}\}/g, renderPublishedLine(history))
    .replace(/\{\{HISTORY_SECTION\}\}/g, renderHistorySection(app.repo, history))
    .replace(/\{\{AUDIT_BADGE\}\}/g, renderAuditBadge(auditMap.get(app.id)))
    .replace(/\{\{VIEWPORT_BADGE\}\}/g, renderViewportBadge(manifests[i]));

  fs.writeFileSync(path.join(DIST, 'apps', `${app.id}.html`), html);
});

// --- Generate sitemap.xml ---

const today = new Date().toISOString().split('T')[0];
const sitemapEntries = [
  '  <url><loc>https://freeappstore.online/</loc><priority>1.0</priority></url>',
  '  <url><loc>https://freeappstore.online/about.html</loc><priority>0.8</priority></url>',
  '  <url><loc>https://freeappstore.online/contribute.html</loc><priority>0.7</priority></url>',
  '  <url><loc>https://freeappstore.online/create.html</loc><priority>0.9</priority></url>',
  '  <url><loc>https://freeappstore.online/build-with-ai.html</loc><priority>0.85</priority></url>',
  '  <url><loc>https://freeappstore.online/ai/claude-code.html</loc><priority>0.7</priority></url>',
  '  <url><loc>https://freeappstore.online/ai/cursor.html</loc><priority>0.7</priority></url>',
  '  <url><loc>https://freeappstore.online/ai/github-copilot.html</loc><priority>0.7</priority></url>',
  '  <url><loc>https://freeappstore.online/ai/aider.html</loc><priority>0.7</priority></url>',
  '  <url><loc>https://freeappstore.online/ai/codex.html</loc><priority>0.7</priority></url>',
  '  <url><loc>https://freeappstore.online/ai/windsurf.html</loc><priority>0.7</priority></url>',
  '  <url><loc>https://freeappstore.online/ai/zed.html</loc><priority>0.7</priority></url>',
  '  <url><loc>https://freeappstore.online/ai/continue.html</loc><priority>0.7</priority></url>',
  '  <url><loc>https://freeappstore.online/ai/cline.html</loc><priority>0.7</priority></url>',
  '  <url><loc>https://freeappstore.online/ai/chatgpt-web.html</loc><priority>0.7</priority></url>',
  '  <url><loc>https://freeappstore.online/guidelines.html</loc><priority>0.7</priority></url>',
  '  <url><loc>https://freeappstore.online/quality.html</loc><priority>0.7</priority></url>',
  '  <url><loc>https://freeappstore.online/privacy.html</loc><priority>0.5</priority></url>',
  '  <url><loc>https://freeappstore.online/terms.html</loc><priority>0.5</priority></url>',
  ...apps.map(app =>
    `  <url><loc>https://freeappstore.online/apps/${app.id}.html</loc><priority>0.9</priority></url>`
  )
];

const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${sitemapEntries.join('\n')}
</urlset>
`;

fs.writeFileSync(path.join(DIST, 'sitemap.xml'), sitemap);

// --- Copy static assets ---

const filesToCopy = [
  'style.css',
  'search.js',
  'quality.js',
  'favicon.svg',
  'apple-touch-icon.png',
  'icon-192.png',
  'icon-512.png',
  'robots.txt',
  '404.html',
  'about.html',
  'contribute.html',
  'guidelines.html',
  'privacy.html',
  'terms.html',
  'build-with-ai.html',
  'pricing.html',
  'auth.js',
];

filesToCopy.forEach(file => {
  const src = path.join(ROOT, file);
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, path.join(DIST, file));
  }
});

// AI tool guides — one HTML file per tool (claude-code, cursor, etc.).
// They live under /ai/<slug>.html so the URL space stays clean.
const aiSrcDir = path.join(ROOT, 'ai');
if (fs.existsSync(aiSrcDir)) {
  const aiDestDir = path.join(DIST, 'ai');
  fs.mkdirSync(aiDestDir, { recursive: true });
  for (const f of fs.readdirSync(aiSrcDir)) {
    if (!f.endsWith('.html')) continue;
    fs.copyFileSync(path.join(aiSrcDir, f), path.join(aiDestDir, f));
  }
}

// Auditor fixture under /audit-fixture/. Single static page with
// query-param-driven scenarios — see audit-fixture/index.html for the
// scenarios + their expected audit verdicts. Hosted same-origin so the
// /quality dashboard can iframe it without any CORS dance. Mirror of
// the fgs storefront's deploy.
const fixtureSrcDir = path.join(ROOT, 'audit-fixture');
if (fs.existsSync(fixtureSrcDir)) {
  const fixtureDestDir = path.join(DIST, 'audit-fixture');
  fs.mkdirSync(fixtureDestDir, { recursive: true });
  for (const f of fs.readdirSync(fixtureSrcDir)) {
    fs.copyFileSync(path.join(fixtureSrcDir, f), path.join(fixtureDestDir, f));
  }
}

// SKILLS.md → dist/skills.md (lowercase for URL compatibility)
const skillsSrc = path.join(ROOT, 'SKILLS.md');
if (fs.existsSync(skillsSrc)) {
  fs.copyFileSync(skillsSrc, path.join(DIST, 'skills.md'));
}

console.log(`Built ${apps.length} app cards into dist/index.html`);
console.log(`Generated ${apps.length} detail pages in dist/apps/`);
console.log('Generated dist/sitemap.xml');
console.log('Copied static assets');
})().catch((err) => {
  console.error('build failed:', err);
  process.exit(1);
});
