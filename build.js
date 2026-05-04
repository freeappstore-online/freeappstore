const fs = require('fs');
const path = require('path');

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

apps.forEach(app => {
  const offline = app.type === 'standalone' ? 'Yes' : 'When cached';
  const account = app.type === 'standalone' ? 'Not required' : 'Not required';

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
    .replace(/\{\{ACCOUNT\}\}/g, account);

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
