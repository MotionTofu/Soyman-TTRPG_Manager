# Design

<!-- impeccable:design-schema 1 -->

**Source of truth:** [`docs/design-system-punk-zine.md`](docs/design-system-punk-zine.md) —
the full "PUNK ZINE" design system (palette modes, typography voices, texture
layer, grid/spacing, dice-as-numbers, mobile tab bar, component norms). Read
that document for direction and rules. This file only covers what it doesn't:
where each piece actually lives in this codebase.

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

Шкала задана в `client/src/index.css` `:root` и от темы не зависит:
`--fs-micro` 10 для коротких капс-подписей, `--fs-meta` 12 для компактной
служебной информации, `--fs-data` 14 для значений, `--fs-body` 16 для длинного
текста, `--fs-h3` 16 и `--fs-h2` 26 для заголовков. Крупные заголовки и числа
используют `--fs-h1` / `--fs-hero` / `--fs-stat`.

Приоритет читаемости: длинные абзацы не набираются служебным кеглем 12 px.
Близкие размеры различаются гарнитурой, капсом и трекингом; правило скачка
×1.6 относится к декоративной иерархии заголовков, а не к прозе.
Для экранной прозы применяется `.reading-text` (16 px, интерлиньяж 1.6,
ограничение длины строки), а общий кегль страницы остаётся 12 px для компактных
контролов и списков. Печатные листы и OneShot имеют собственные правила.

`client/scripts/check-type-scale.mjs` ищет сырые `font-size: Npx` в `.css` и
`fontSize: N` в `.tsx`; он подключён к `npm run build` и `npm run lint`.
Печатная шпаргалка (`.cheatsheet-*`, `.dnd-cheatsheet-*`, `.combat-row*`,
`.combat-field`, `.fill-box`) исключена из экранной шкалы. Сейчас проверка
находит существующие нарушения в других частях клиента, поэтому прохождение
всей сборки пока нельзя считать подтверждением соблюдения шкалы.

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
