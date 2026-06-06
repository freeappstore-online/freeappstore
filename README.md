# FreeAppStore Storefront

Static HTML storefront for [freeappstore.online](https://freeappstore.online). Built with `node build.js` from `registry.json` — no framework, no npm dependencies.

## Build

```bash
node build.js    # generates dist/ from registry.json + page templates
node --test test/build.test.mjs  # security + compliance tests
```

## Deploy

Hosted on Cloudflare Pages. Push to `main` auto-deploys via GitHub Actions.

## Pages

| Page | File | Description |
|------|------|-------------|
| Home | `index.html` (generated) | App grid with category filters |
| App detail | `dist/<id>/index.html` | Per-app detail page |
| Developer | `developers.html` | Developer profile pages |
| About | `about.html` | Platform info |
| Contribute | `contribute.html` | How to publish |
| Build with AI | `build-with-ai.html` | VibeCode guide |
| Capabilities | `capabilities.html` | SDK features overview |
| Pricing | `pricing.html` | Free vs Pro comparison |
| Skills | `skills.md` | AI agent guide |

## Key files

- `build.js` — Static site generator (reads `registry.json`, emits HTML)
- `registry.json` — Source of truth for all published apps
- `SECURITY.md` — CSP, headers, threat model
- `_headers` — Cloudflare Pages headers (CSP, HSTS, etc.)
