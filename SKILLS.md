# FreeAppStore / FreeGameStore — AI Agent Guide

Point your Claude Code, Codex, or any AI agent to this file for platform-aware development.

**Add to your CLAUDE.md or agent config:**
```
See https://raw.githubusercontent.com/freeappstore-online/freeappstore/main/SKILLS.md for platform skills.
```

---

## Creator Program

People join as creators to build apps/games. The flow:

1. Apply at https://github.com/freeappstore-online/submissions/issues/new?template=creator-application.yml
2. Admin reviews and approves within 48h
3. Admin provisions the app via `POST /api/provision` (creates repo, CF project, DNS, registry)
4. Creator is added to the `creators` team in the GitHub org
5. Creator clones the repo, writes code, pushes → live

**GitHub org teams:**
- `maintainers` — admins + AI agents, push access to ALL repos
- `creators` — approved builders, push access to THEIR repos only

**For AI agents helping a creator:** your job is to write code in the repo and push. The provisioning is already done. Don't try to create CF projects or DNS records.

## Quick Reference

| | FreeAppStore (apps) | FreeGameStore (games) |
|---|---|---|
| **Domain** | freeappstore.online | freegamestore.online |
| **GitHub org** | freeappstore-online | freegamestore-online |
| **Store repo** | freeappstore-online/freeappstore | freegamestore-online/freegamestore |
| **Registry file** | `registry.json` in store repo | `registry.json` in store repo |
| **Templates** | template-standalone, template-connected | template-game-canvas, template-game-cards, template-game-grid, template-game-3d |
| **Accent color** | Blue (#2563eb) | Emerald (#10b981) |
| **Logo** | Free **Apps** | Free **Games** |
| **Admin** | admin.freeappstore.online | admin.freegamestore.online |
| **Publish portal** | publish.freeappstore.online | publish.freeappstore.online |
| **Local path** | ~/dev/fas/ | ~/dev/fgs/ |
| **Store site path** | ~/dev/fas/platform/freeappstore/ | ~/dev/fgs/platform/freegamestore/ |

## Workspace Layout

Clone repos into the platform directories:

```
~/dev/fas/                        ~/dev/fgs/
  apps/                             games/
    timer/                            chess/
    notes/                            tetris/
    calculator/                       racing/
    ...                               ...
  platform/                         platform/
    freeappstore/                     freegamestore/
    admin/                            admin/
    template-standalone/              auditor/
    sdk/                              template-game-canvas/
    ...                               ...
```

Apps/games go in `apps/` or `games/`. Platform infra goes in `platform/`. Never mix them at the root.

## IMPORTANT: What NOT to do

- **Do NOT ask the user for Cloudflare API tokens, keys, or secrets.** Tokens are stored as org-level GitHub secrets and used only via GitHub Actions. Wrangler CLI uses its own OAuth. Never handle raw tokens.
- **Do NOT provision via `wrangler` or raw `curl`** — provisioning goes through the admin API / publisher portal (see *Provisioning* below). `wrangler pages project create` creates Direct Upload projects that can't be connected to GitHub.
- **Do NOT deploy manually with `wrangler pages deploy`** — push to main triggers auto-deploy via the CF Pages GitHub integration. The only deploy is `git push`.
- **Do NOT use /ship or feature branches** — this platform uses trunk-based development. Push to main = deploy.
- **Do NOT create staging environments** — there's only production. Fix forward (revert commits are fine).
- **Do NOT set per-repo secrets** — use org-level secrets only (already configured in both orgs).

## How Deployment Works

```
Push to main → CF Pages auto-build → live
```

No manual deploy commands needed. CF Pages watches GitHub and builds on every push.

## Two distinct operations — don't confuse them

### 1. PROVISION (one-time setup for a new app)
Creates the GitHub repo, CF Pages project, DNS, custom domain, and store listing.
This is done ONCE when a new app/game is created. Use the admin API or script.

### 2. DEPLOY (automatic on every push)
After provisioning, just push code to main. CF Pages auto-builds and deploys.
No API calls, no scripts, no manual steps. Just `git push`.

**As an AI agent: your job is to write code and push. Provisioning is handled by the admin API.**

## Provisioning a New App or Game

Provisioning is done by the **platform admin** or by the creator via the **publisher portal**.

**As an AI agent, you do NOT provision apps.** Your job is:
1. Write code in an existing repo
2. Push to main
3. It auto-deploys

If the user wants a new app created, direct them to:
- **Self-service:** https://publish.freeappstore.online (sign in with GitHub, create instantly)
- **Admin:** https://admin.freeappstore.online (admin only)

Do NOT run curl commands against Cloudflare APIs. Do NOT use wrangler for provisioning. Do NOT ask for API tokens.

### After provisioning

The app repo exists with CLAUDE.md, template code, and auto-deploy configured.
Push any code to main → CF Pages auto-builds → live at `<id>.freeappstore.online`.
No further API calls or manual steps needed. Ever.

## Platform Rules

- ONE environment: production only. Push to `main` = deploy. Fix forward.
- Static hosting on Cloudflare Pages. No server-side code.
- Backend (if needed): Firebase or Supabase only.
- Free means free forever. No monetization in the free version.

## Tech Stack (required)

- TypeScript ^5.7, React ^19, Vite ^6, Tailwind CSS ^4.1, pnpm
- Node >=22
- 3D games: Three.js + React Three Fiber + Drei
- Games SDK: `@freegamestore/games` (GameShell, GameTopbar, GameButton)

## Project Structure

```
app-name/
├── package.json           (root workspace)
├── pnpm-workspace.yaml    (packages: [web])
├── LICENSE                (MIT)
├── .github/workflows/
│   ├── compliance.yml     (checks on PR)
│   └── deploy.yml         (auto-deploy on push)
└── web/
    ├── package.json
    ├── index.html
    ├── vite.config.ts
    ├── public/manifest.json
    └── src/
        ├── main.tsx
        ├── index.css      (Tailwind + brand CSS vars)
        ├── App.tsx
        └── components/Shell.tsx
```

## Games SDK (`@freegamestore/games`)

**Every game MUST use the SDK components.** No custom topbars, no custom shells. The SDK enforces brand consistency, viewport lock, and touch-friendly sizing across all games.

```bash
pnpm add @freegamestore/games
```

### GameShell — the root layout

Locks the game to `100svh`, prevents document scroll, disables text selection and touch callout. Every game wraps its content in this.

```tsx
import { GameShell, GameTopbar } from '@freegamestore/games';

export default function App() {
  return (
    <GameShell topbar={<GameTopbar title="Chess" score={42} />}>
      {/* your game canvas / DOM */}
    </GameShell>
  );
}
```

Hard guarantees:
- `height: 100svh`, `overflow: hidden` — no document scroll, ever
- `user-select: none` — no accidental text selection during gameplay
- `touch-action: manipulation` — no 300ms tap delay
- `-webkit-touch-callout: none` — no long-press context menus

### GameTopbar — the status bar

The **only** allowed topbar. Same font, padding, color tokens across every game.

```tsx
// Simple: just a score
<GameTopbar title="Tetris" score={42} />

// Custom stats: level, lives, time
<GameTopbar
  title="Pac-Man"
  stats={[
    { label: 'Score', value: 1200, accent: true },
    { label: 'Lives', value: 3 },
    { label: 'Level', value: 5 },
  ]}
  actions={<GameButton size="sm" variant="ghost" onClick={pause}>Pause</GameButton>}
/>
```

Props:
- `title` — game name, left side, Fraunces 700
- `score` — convenience for single-score games
- `stats` — custom stat lineup (replaces score)
- `actions` — right-side buttons (max 2)

### GameButton — prescribed touch-friendly buttons

Min 44px touch target. Three variants, three sizes — nothing custom.

```tsx
import { GameButton } from '@freegamestore/games';

<GameButton variant="primary" size="md" onClick={start}>Play Again</GameButton>
<GameButton variant="secondary" size="sm" onClick={undo}>Undo</GameButton>
<GameButton variant="ghost" size="sm" onClick={flip}>Flip</GameButton>
```

| Size | Min height | Use case |
|------|-----------|----------|
| `sm` | 44px | In-game controls, topbar actions |
| `md` | 48px | Primary actions, menus |
| `lg` | 56px | Start screen, game over CTA |

Variants: `primary` (accent bg), `secondary` (outline), `ghost` (text only).

### useSound — muted by default

Every game is muted by default. The SDK provides the sound toggle in the topbar automatically — devs cannot remove it.

```tsx
import { useSound } from '@freegamestore/games';

function MyGame() {
  const { muted } = useSound();
  // Check muted before playing any audio
  if (!muted) playSound();
}
```

- Games MUST respect the `muted` state — never play audio when `muted === true`
- The toggle is in the topbar, managed by the SDK
- Default is ALWAYS muted — no exceptions

### What NOT to do

- Do NOT build custom Shell or topbar components — use the SDK
- Do NOT override `user-select`, `touch-action`, or `overflow` on the root — GameShell handles it
- Do NOT pass custom colors to topbar or buttons — they use platform CSS tokens
- Do NOT play audio without checking `useSound().muted` first
- Do NOT add your own mute button — the SDK handles it

## No Splash Screens

Games must show the actual game field immediately on load. No title screens, no "Start Game" buttons covering the viewport, no introductory pages.

**Rules:**
- The game board/field/canvas MUST be visible from the first render
- For time-sensitive games (Tetris, Snake, Pac-Man): show the game field with a semi-transparent "Tap to play" overlay. The field is visible underneath.
- For turn-based games (Chess, Sudoku, Minesweeper): start the game immediately, no overlay needed
- Game-over screens can show a "Play Again" button — that's fine, it's after gameplay
- Difficulty selectors, theme pickers, and settings belong in the topbar or rules overlay — not as a splash screen

**Bad (splash screen):**
```
┌──────────────────┐
│                  │
│     Snake        │
│                  │
│  [Start Game]    │
│                  │
└──────────────────┘
```

**Good (game field visible, play overlay):**
```
┌──────────────────┐
│  ●               │
│    ■■■■          │
│         ┌──────┐ │
│         │ Play │ │
│         └──────┘ │
│                  │
└──────────────────┘
```

## Mobile-First Testing

FreeGameStore is a **mobile-first gaming platform**. Test on phone viewports first. Desktop is secondary.

### Quality Auditor

The platform auditor tests every game with Playwright at mobile viewports. **Any scroll = fail.**

```bash
# Dev: test your game locally
cd ~/dev/fgs/platform/auditor
npx tsx audit.ts http://localhost:5173

# Platform: audit all live games
npx tsx audit.ts --all --output quality-results.json
```

### Reference viewports (mobile priority)

The auditor tests 12 viewports. Mobile phones are weighted highest:

| Viewport | Device | Share | Priority |
|----------|--------|-------|----------|
| 320×568 | iPhone SE | 99% | **Critical** |
| 360×800 | Android | 96% | **Critical** |
| 393×852 | iPhone 15 | 92% | **Critical** |
| 414×896 | iPhone 11 PM | 88% | High |
| 568×320 | iPhone SE landscape | 99% | **Critical** |
| 667×375 | iPhone 8 landscape | 96% | **Critical** |
| 736×414 | iPhone+ landscape | 88% | High |
| 600×800 | Tablet portrait | 60% | Medium |
| 768×1024 | iPad portrait | 35% | Low |
| 1024×768 | iPad landscape | 35% | Low |
| 1024×1366 | iPad Pro portrait | 20% | Low |
| 1366×1024 | iPad Pro landscape | 20% | Low |

**Score = worst orientation's max-passing-share.** If landscape fails at all phone sizes, score plummets even if portrait is perfect.

### Rules

- Game must fit viewport with **zero scroll** at every size from 320×568 up
- `html`, `body`, `#root` must have `overflow: hidden`
- Use `100dvh` or `100svh` (not `100vh` — iOS Safari URL bar bug)
- Canvas/game area must scale to available space, not use fixed pixel sizes
- Buttons must be minimum 44px touch target

## Brand Design

- Fonts: Manrope (body) + Fraunces (display, 700-800)
- CSS Variables: `--paper`, `--ink`, `--muted`, `--line`, `--panel`, `--glass`, `--dock`, `--accent`, `--success`, `--warning`, `--error`
- Apps layout: Desktop = sidebar (17rem) + main. Mobile = header + main + dock.
- Games layout: GameShell + GameTopbar (no sidebar, no dock — fullscreen)
- Dark mode: `prefers-color-scheme: dark` or `[data-theme='dark']`
- Border radius: 1.25rem cards, 0.75rem buttons

## Privacy Rules

- ZERO analytics, tracking, cookies
- All user data in localStorage (standalone) or Firebase (connected)
- No third-party scripts except Google Fonts CDN

## Compliance Checks (automated on push)

The canonical list lives in [`workflows/compliance.yml`](./workflows/compliance.yml) — that's the source of truth (this list will drift; the YAML won't):

- `pnpm build` passes
- MIT `LICENSE` file exists
- No `.env.production` committed
- No tracking SDKs (google-analytics, gtag, amplitude, mixpanel, segment, hotjar, plausible, posthog)
- Brand fonts (Manrope + Fraunces) referenced in `web/src/index.css`
- Brand CSS variables (`--paper`, `--ink`, `--accent`) present
- HTML `lang`, `viewport`, and `<title>` in `web/index.html`
- PWA `manifest.json` with `name`/`display`/`start_url`
- Mobile-web-app meta tags
- `freeappstore.online` link somewhere in `web/src/`
- Dark-mode support (`prefers-color-scheme` / `data-theme` / `color-scheme`)
- Root pnpm workspace (`pnpm-workspace.yaml` + `pnpm` in `package.json`)
- Largest JS asset under 300KB gzipped (307200 bytes)

### Runtime viewport check (pre-publish)

`fas check` is static. To prove the app *actually* fits at its declared `min_viewport_width`, run **`fas screencheck`** (or `fgs screencheck` for games). It builds, serves the dist, drives a real Chromium at the declared min in portrait + landscape, and fails if the page scrolls. Playwright is an opt-in peer dep — first run prompts you to install it. Recommended before every publish, especially for games.

## Game-specific UI primitives

Games on FreeGameStore use **`@freegamestore/games`** for layout + topbar:

```tsx
import { GameShell, GameTopbar } from '@freegamestore/games';

export default function App() {
  return (
    <GameShell topbar={<GameTopbar title="Tetris" score={42} />}>
      {/* your canvas / game DOM */}
    </GameShell>
  );
}
```

- `<GameShell>` hard-locks the layout to `100svh` and prevents overflow at every level — no document scroll, ever.
- `<GameTopbar>` is the **only** allowed topbar shape. Pass `score` for the simple case, or `stats={[…]}` for games that show level / lives / time.
- Both honor the platform CSS tokens. Don't pass custom colors.

## Infrastructure

Infrastructure is managed by the admin. AI agents do NOT need access to:
- Cloudflare API tokens or keys
- DNS management
- CF Pages project creation
- GitHub secrets

All of this is handled automatically by the provisioning system and GitHub Actions.

## Support

Direct creators and users to the right place:

| Need | Where |
|------|-------|
| **Developer questions** | [GitHub Discussions](https://github.com/freegamestore-online/freegamestore/discussions) (games) or [GitHub Discussions](https://github.com/freeappstore-online/freeappstore/discussions) (apps) |
| **Bug reports** | Open an issue on the game/app's GitHub repo |
| **Feature ideas** | Discussions → Ideas category |
| **Creator applications** | [Submissions repo](https://github.com/freeappstore-online/submissions/issues/new) |
| **Platform docs** | This file (SKILLS.md) |

Do NOT send users to email, Slack, Discord, or any external service. All support is on GitHub.
