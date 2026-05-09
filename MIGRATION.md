# Store Site Migration: Static HTML → React+Vite+Tailwind

## Why

The store site is the only part of the platform not using the standard stack.
It's 20+ HTML files with duplicated headers, footers, nav, and inline JS.
Every nav change requires editing all files. Auth logic is duplicated.
The VibeCode page is a complex app fighting against plain JS.

## Current state

```
freeappstore/
├── build.js              ← Node script that copies files + generates pages from templates
├── style.css             ← Global styles (837 lines)
├── auth.js               ← Auth + hamburger menu injection
├── create.html + .css + .js  ← VibeCode page (3 files, 1009 lines total)
├── profile.html          ← Profile page (257 lines, inline JS)
├── about.html            ← Static page
├── contribute.html       ← Static page
├── guidelines.html       ← Static page
├── privacy.html          ← Static page
├── terms.html            ← Static page
├── build-with-ai.html    ← Static page
├── 404.html              ← Static page
├── templates/
│   ├── index.html        ← App catalog template (build.js generates from registry.json)
│   ├── app-detail.html   ← Per-app detail template
│   └── quality.html      ← Quality dashboard template
├── ai/*.html             ← 10 AI tool guide pages
└── registry.json         ← App catalog data
```

## Target state

```
freeappstore/
├── web/
│   ├── package.json      ← React 19, Vite 6, Tailwind 4.1, TypeScript
│   ├── vite.config.ts
│   ├── index.html
│   └── src/
│       ├── main.tsx
│       ├── App.tsx         ← Router
│       ├── index.css       ← Tailwind + CSS vars (reuse existing)
│       ├── components/
│       │   ├── Layout.tsx        ← Header + nav + footer (single source of truth)
│       │   ├── Nav.tsx           ← Desktop nav + mobile hamburger
│       │   ├── AuthProvider.tsx  ← Auth context (replaces auth.js)
│       │   └── Avatar.tsx        ← Nav avatar
│       ├── pages/
│       │   ├── Home.tsx          ← App catalog (from registry.json)
│       │   ├── AppDetail.tsx     ← Per-app page
│       │   ├── About.tsx
│       │   ├── Build.tsx
│       │   ├── Guidelines.tsx
│       │   ├── Create.tsx        ← VibeCode (biggest win — proper React state)
│       │   ├── Profile.tsx
│       │   ├── Quality.tsx
│       │   ├── Privacy.tsx
│       │   ├── Terms.tsx
│       │   └── AIGuide.tsx       ← Dynamic route for /ai/:tool
│       ├── hooks/
│       │   ├── useAuth.ts
│       │   └── useAgent.ts       ← SSE streaming, tool handling, session mgmt
│       └── lib/
│           ├── api.ts            ← API client
│           └── registry.ts       ← Fetch/cache registry.json
├── registry.json
└── package.json
```

## Migration steps

1. Scaffold with `template-standalone` (same stack as all apps)
2. Set up React Router for all routes
3. Build Layout component (header + nav + footer — eliminate 20-file duplication)
4. Build AuthProvider (replace auth.js — single auth context for all pages)
5. Migrate static pages (about, privacy, terms, etc.) — just JSX, minimal logic
6. Migrate app catalog (Home) — fetch registry.json, render cards
7. Migrate app detail pages — dynamic route /apps/:id
8. Migrate VibeCode (Create) — biggest page, benefits most from React
9. Migrate Profile
10. Migrate Quality dashboard
11. Migrate AI guide pages — single component with dynamic content
12. Update CF Pages build command from `node build.js` to `pnpm build`
13. Test all routes, auth flow, deploy flow
14. Cut over

## What gets better

- **Nav/header/footer**: one component, not 20+ duplicated HTML blocks
- **Auth**: React context, not a script that injects DOM elements
- **VibeCode**: proper React state management for chat, streaming, projects, voice
- **Routing**: client-side navigation, no full page reloads
- **Type safety**: TypeScript everywhere
- **Mobile nav**: React component, not DOM injection in auth.js
- **New pages**: add a file, add a route — no build.js or filesToCopy changes

## What to watch out for

- **SEO**: static pages currently render server-side. React SPA needs prerendering
  or SSR for SEO. CF Pages supports `_headers` and `_redirects` for SPA routing.
  For SEO-critical pages (home, about), consider prerendering at build time.
- **registry.json**: currently baked into index.html at build time. In React,
  fetch it at runtime or import it as a JSON module.
- **Build time data**: app detail pages pull commit history from GitHub API at
  build time. In React, fetch at runtime or use a build-time data layer.
- **AI guide pages**: 10 separate HTML files with similar structure. Convert to
  one component with content loaded from markdown or a data file.

## Estimated effort

- Layout + Auth + Router: 1 session
- Static pages: 1 session
- Home + App detail: 1 session
- VibeCode + Profile: 1-2 sessions
- Quality + AI guides: 1 session
- Testing + cutover: 1 session

Total: ~6 sessions
