# Design

<!-- impeccable:design-schema 1 -->

**Source of truth:** [`docs/design-system-punk-zine.md`](docs/design-system-punk-zine.md) —
the full "PUNK ZINE" design system (palette modes, typography voices, texture
layer, grid/spacing, dice-as-numbers, mobile tab bar, component norms). Read
that document for direction and rules. This file only covers what it doesn't:
where each piece actually lives in this codebase.

## Where things live in code

| Concern | File |
|---|---|
| Theme tokens (`--paper`/`--ink`/`--accent`/etc, all five app themes) | `client/src/themes.ts` — `buildTheme()`/`skinTheme()`; `zine` is the default (see `loadThemePrefs`'s fallback) |
| Global token defaults / pre-JS FOUC guard | `client/src/index.css` `:root` block (mirrors the "Классическая" theme byte-for-byte) |
| Statblock theme tokens (zine/noir/aberrant) | `client/src/statblockThemes.ts` (theme list) + `client/src/statblockThemes.css` (`.sb-scope`-local `--paper`/`--ink`/`--muted`/`--line` bridge variables — an independent namespace from the app theme, deliberately not aliased to it) |
| Fonts (Display/Body, self-hosted via Google Fonts) | `client/src/fonts.ts`, loaded in `index.html` |
| Texture utilities (grain, halftone, marker underline/highlight, torn edges, rotate) | `client/src/zine.css`, imported from `main.tsx` |
| Drawn nav/UI icons (`<NavIcon name="...">`) | `client/src/components/NavIcons.tsx` |
| Decorative zine marks (mascot, anarchy star, splatter, barcode, issue stamp) | `client/src/components/ZineGraphics.tsx` — abstract line art only, never a generated/photographic image of the user's actual campaigns/characters |
| Empty-state pattern (mascot + Display slogan + one action) | `client/src/components/EmptyState.tsx` |
| Dice-as-numbers component (`<Die>`, ability/save flip-dice) | `client/src/components/Dice.tsx`, used by `client/src/components/dnd/AbilitySavesSkills.tsx` |
| Mobile bottom nav (raised center button + quick-access sheet) | `client/src/layout/AppShell.tsx`, `client/src/layout/MobileQuickAccess.tsx` |

## The "one frame per region" rule — implementation note

The design doc's "no nested frame" constraint (a card placed inside another
card must not draw a second border/background/padding of its own) is
enforced structurally, not by convention: `index.css` flattens `.card .card`
to `border: none; background: none; padding: 0` at the CSS level, so it
holds everywhere automatically rather than depending on every call site
remembering to check. The mobile fullscreen statblock overlay
(`.sb-fullscreen-mobile`) follows the same rule.

## Notes specific to this codebase

- Two design docs used to duplicate this material; this file is now just the
  code map, not a second copy of the direction. If something here and
  `docs/design-system-punk-zine.md` ever disagree, the doc wins — update
  this file to match rather than the other way around.
- A handful of legacy CSS variable names (`--bg-elevated`, `--text-bright`)
  still exist alongside the design-doc vocabulary because they have no exact
  §3.1 equivalent (an elevated-surface mix and a dark-mode-brightened ink,
  respectively) — see the comments next to them in `themes.ts` and
  `index.css`. Every other legacy alias (`--bg`, `--bg-panel`, `--border`,
  `--text`, `--text-dim`) has been fully migrated to the design-doc names
  (`--paper`, `--paper-2`, `--line`, `--ink`, `--muted`) and removed.
