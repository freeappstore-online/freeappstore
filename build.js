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

async function fetchAppHistory(repo) {
  // repo is "owner/name". Two parallel calls: repo metadata for created_at,
  // and the last 3 commits for the changelog. We only show 3 inline;
  // the "see all on GitHub" link covers depth. Failures degrade
  // gracefully — the section just shows "history unavailable".
  try {
    const [meta, commits] = await Promise.all([
      ghFetch(`/repos/${repo}`),
      ghFetch(`/repos/${repo}/commits?per_page=3`),
    ]);
    return { meta, commits };
  } catch (err) {
    console.warn(`  ! could not fetch history for ${repo}: ${err.message}`);
    return { meta: null, commits: null };
  }
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

let indexHtml = indexTemplate
  .replace('{{FILTER_BUTTONS}}', filterButtons)
  .replace('{{APPS_GRID}}', appCards);

fs.writeFileSync(path.join(DIST, 'index.html'), indexHtml);

// --- Generate app detail pages ---
// Fetch histories in parallel — 26 apps × 2 calls = 52 requests, well under
// authenticated GitHub rate limits (5000/hr) and ~5–10s wall time.
// Wrapped in async IIFE because this file is CJS (no top-level await).

(async () => {
console.log(`Fetching commit history for ${apps.length} apps...`);
const histories = await Promise.all(apps.map((app) => fetchAppHistory(app.repo)));
// Summarize: count how many apps got real commit data vs fell back. A
// silent rate-limit failure used to be invisible until the live page
// showed "No updates yet" — this line makes it obvious from CI alone.
const okCount = histories.filter((h) => Array.isArray(h?.commits) && h.commits.length > 0).length;
console.log(`  ${okCount}/${apps.length} apps got commit history`);

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
    .replace(/\{\{HISTORY_SECTION\}\}/g, renderHistorySection(app.repo, history));

  fs.writeFileSync(path.join(DIST, 'apps', `${app.id}.html`), html);
});

// --- Generate sitemap.xml ---

const today = new Date().toISOString().split('T')[0];
const sitemapEntries = [
  '  <url><loc>https://freeappstore.online/</loc><priority>1.0</priority></url>',
  '  <url><loc>https://freeappstore.online/about.html</loc><priority>0.8</priority></url>',
  '  <url><loc>https://freeappstore.online/contribute.html</loc><priority>0.7</priority></url>',
  '  <url><loc>https://freeappstore.online/guidelines.html</loc><priority>0.7</priority></url>',
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
  'terms.html'
];

filesToCopy.forEach(file => {
  const src = path.join(ROOT, file);
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, path.join(DIST, file));
  }
});

console.log(`Built ${apps.length} app cards into dist/index.html`);
console.log(`Generated ${apps.length} detail pages in dist/apps/`);
console.log('Generated dist/sitemap.xml');
console.log('Copied static assets');
})().catch((err) => {
  console.error('build failed:', err);
  process.exit(1);
});
