# Design

<!-- impeccable:design-schema 1 -->

**Source of truth:** [`docs/design-system.md`](docs/design-system.md) —
design system v2 «Д» (2026-10-29): two themes, tokens, type scale, decor
dose per screen, components. PUNK ZINE (`docs/design-system-punk-zine.md`)
is archived. This file only covers where each piece lives in code; the code
map below still describes the pre-v2 state until the token step lands.

## OneShot visual scope

`SoyMan_1shot/` is a separate product surface with a deliberately fixed
Fantasy Punk identity. For its Library, Wizard, Sheet, dialogs and standalone
HTML, use [`SoyMan_1shot/REDESIGN_RULES.md`](SoyMan_1shot/REDESIGN_RULES.md)
as the visual decision source. The root PUNK ZINE system still supplies shared
infrastructure and universal usability/accessibility constraints; its theme
palette and component appearance do not override the OneShot-specific rules.
Shared components adopt the OneShot appearance only through an explicit
OneShot scope or opt-in variant, leaving the rest of SoyMan unchanged.

Within that scope, the priority is: actual product behavior and data contracts
first, then `REDESIGN_RULES.md`, then
[`Design_Codex_V1.md`](SoyMan_1shot/Redesign_Concepts/Design_Codex_V1.md)
as a stylistic reference. `Concept_001.png` is the primary desktop Sheet
composition reference; `PC.png` and `Mobile.png` are secondary style references,
not specifications for screen structure or available features. This precedence
is also recorded at the top of `REDESIGN_RULES.md`.

## Where things live in code

| Concern | File |
|---|---|
| Shared production asset masters, manifest and searchable catalog | `assets/library/`, `assets/manifest.json`, `assets/README.md`; ADR-0005. Public and bundled paths are synchronized copies. |
| Theme tokens (`--paper`/`--ink`/`--accent`/etc, all five app themes) | `client/src/themes.ts` — `buildTheme()`/`skinTheme()`; `noir` is the default (`DEFAULT_THEME_ID = "noir"`, see `loadThemePrefs` fallback) |
| Global token defaults / pre-JS FOUC guard | `client/src/index.css` `:root` block (mirrors the "Соевый нуар"/`noir` theme byte-for-byte to avoid FOUC) |
| Statblock theme tokens (zine/noir/aberrant) | `client/src/statblockThemes.ts` (theme list) + `client/src/statblockThemes.css` (`.sb-scope`-local `--paper`/`--ink`/`--muted`/`--line` bridge variables — an independent namespace from the app theme, deliberately not aliased to it) |
| Fonts (Display/Body, self-hosted via Google Fonts) | `client/src/fonts.ts`, loaded in `index.html` |
| Texture utilities (grain, halftone, marker underline/highlight, torn edges, rotate) | `client/src/zine.css`, imported from `main.tsx` |
| Drawn nav/UI icons (`<NavIcon name="...">`) | `client/src/components/NavIcons.tsx` |
| Decorative zine marks (mascot, anarchy star, splatter, barcode, issue stamp) | `client/src/components/ZineGraphics.tsx` — abstract line art only, never a generated/photographic image of the user's actual campaigns/characters |
| Empty-state pattern (mascot + Display slogan + one action) | `client/src/components/EmptyState.tsx` |
| Dice-as-numbers component (`<Die>`, ability/save flip-dice) | `client/src/components/Dice.tsx`, used by `client/src/components/dnd/AbilitySavesSkills.tsx` |
| Mobile bottom nav (raised center button + quick-access sheet) | `client/src/layout/AppShell.tsx`, `client/src/layout/MobileQuickAccess.tsx` |

## Шкала кегля — как она принуждается

Шкала v2 (`docs/design-system.md` §3.2) задана в `client/src/index.css`
`:root` и от темы не зависит: `--fs-micro` 11, `--fs-meta` 12,
`--fs-label` 13, `--fs-data` 14, `--fs-lead` 15, `--fs-body` / `--fs-h3`
16, `--fs-h2` / `--fs-stat` 26, `--fs-h1` 40, `--fs-hero` 64 — без `clamp`.
Для экранной прозы — `.reading-text` (16 px, интерлиньяж 1.6, мера строки).

`client/scripts/check-type-scale.mjs` ищет сырые `font-size: Npx` в `.css`
и `fontSize: N` в `.tsx`; он подключён к `npm run lint` и
`npm run check:design`. Исключения: печатная шпаргалка (`.cheatsheet-*`,
`.dnd-cheatsheet-*`, `.combat-row*`, `.combat-field`, `.fill-box`), файлы
листа и визарда (`fantasy-punk-skin.css`, `dnd-sheet.css`,
`components/dnd/*.css` — облик OneShot до его перевода) и правила с меткой
«кегль мимо шкалы намеренно — <причина>».

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
