# Design

<!-- impeccable:design-schema 1 -->

## Direction

**Панк-зин / Спокойный дистопичный гранж** — a self-published zine for running tabletop campaigns, not a SaaS dashboard. Aged newsprint stock, xerox grain, halftone dot screens, torn/rough edges, a single blood-red accent against black ink on cream paper. Confident and a little worn, never sterile — but restrained: the grain and the red carry the mood, not clutter. Pinned by the user from three references (`references/Ref_01.png` desktop, `references/Ref_02.png` mobile, `references/Ref_03.jpg` the zine-cover source both were generated from) — this is a brief-pinned direction, not a rolled one.

## Palette

Restrained color strategy: neutrals (cream/black) plus exactly one saturated accent (red). Never introduce a second saturated hue as a peer to red — status/role semantics stay inside the black-cream-red family (see Semantic colors below), the same way the reference never adds a second poster color.

| Token | Value | Use |
|---|---|---|
| `--bg` | `#e7dfc9` | Page background — aged cream stock |
| `--bg-panel` | mixed toward black, ~6% | Card/panel surface |
| `--bg-elevated` | mixed toward black, ~10% | Raised surface (inputs, popovers) |
| `--text` | `#181818` | Body ink — near-black, never pure `#000` |
| `--accent` | `#c31f1f` | The one saturated color — CTAs, active states, links, danger |
| `--border` | `#181818` | Ink-black rule, not a soft gray |

Dark passages (nav rail, banner bands, modal chrome) use `--card-band-bg: #181818` with cream/red text on top — this is the reference's "black masthead strip," not a second theme.

## Typography

- **Display** (`--font-display`): Anton — condensed, all-caps-weighted poster grotesque. `text-transform: uppercase` on page titles and card names (`--name-transform: uppercase`), matching the reference's headline treatment ("ТВОИ ИСТОРИИ. ТВОИ ПРАВИЛА.").
- **Body** (`--font-body`): Archivo — a plain, sturdy grotesque that stays legible at small sizes; the display face carries all the personality, the body face gets out of the way.
- Both load self-hosted-via-Google-Fonts already (see `index.html`), consistent with every other built-in theme in this codebase — no new font-loading mechanism.
- No italics, no script faces. Zines set body copy in a plain workhorse face; ornamentation happens in imagery and rules, not letterforms.

## Grid & Spacing

- Existing app grid is unchanged (sidebar + content + right rail on desktop; single column + bottom nav on mobile) — this direction is a *surface* restyle, not a layout rebuild.
- Corner radius: `--card-radius: 0` — the zine world is hard-edged. Rounded corners read as "app," square corners read as "printed page." (Exception: pills/badges/dice may keep a small radius where the reference itself rounds them — status chips, buttons.)
- Border weight: `--card-border-width: 2` — a confident black rule, not a hairline. Rules are structural (they separate content), not decorative.

## The "no nested frame" rule

**This is the direction's one hard constraint, and it was broken before this pass.** A zine page has exactly one frame per region: the page edge, or a card's own black rule — never both at once, and never a card inside a card each drawing its own border/background/padding. Concretely:

- A card placed inside another card inherits the parent's frame; it does not draw a second border, a second background tint, or its own padding box. `.card .card` is flattened to border:none/background:none/padding:0 at the CSS level (see `index.css`) so this holds everywhere automatically, not just where someone remembers to check.
- The mobile fullscreen statblock overlay (`.sb-fullscreen-mobile`) already established this pattern this session (stripped double border/background) — this rule generalizes it app-wide instead of leaving it as a one-off fix.
- When two regions must be visually distinguished, prefer a rule (`border-top`) or a band (`--card-band-bg`) over a second full frame.

## Texture

- `--page-texture`: a fine halftone-dot grain across the whole page background — the "photocopied newsprint" read. Subtle: legible as texture, not as noise that fights body text contrast.
- `--card-band-image`: a sparse dot-halftone pattern on dark bands (card headers, the nav masthead), echoing the reference's newsprint dot screen on the black hero band.
- Texture is atmosphere, never a substitute for hierarchy — it never sits behind small body text at a density that hurts the 4.5:1 contrast floor.

## Signature components

### Audio player

Reference: `Ref_01.png` bottom-left corner. A compact black capsule, rounded (deliberately *not* square — the one place the direction allows a soft shape, because the reference itself rounds it), sitting low and out of the way: track art thumbnail, title, transport (prev/play/next) only. No dense row of secondary icons competing with playback — repeat/shuffle/volume/playlist live in a secondary surface (the existing "Плеер" page / popovers), not inline in the always-visible bar. This is the standard other themes' audio bars don't have to follow, but the zine world's does: **quiet, minimal, legible at a glance.**

### Calendar

Reference: `Ref_01.png` right rail. Day cells are plain rectangles (radius 0, black rule) with a hand-marked accent under the weekday header row and the selected/today date — a single pencil-underline stroke (`--calendar-mark-image`, an SVG squiggle), not a filled highlight box. This is the "pencil underline" the user called out by name: a mark that reads as *annotated*, not *selected-in-a-UI-sense*.

### Roll / dice display

Reference: `Ref_02.png` third screen. A d20 silhouette carries its own number, rather than a bare numeral in a table cell — already built this session as the ability-score/saving-throw flip-dice widget (`AbilityDiceBox` in `AbilitySavesSkills.tsx`). This pattern (value-in-a-die, not value-in-a-cell) is the direction's answer to "how do we show a game-mechanical number," and should be reused anywhere else a roll result or die-backed stat appears before inventing a new numeral treatment.

## Semantic colors

Role/status colors (GM vs player, session planned/held/cancelled, paid/free) stay inside the black-cream-red family rather than importing a rainbow: black and red carry the two most important distinctions (danger, GM), everything else is a tonal step between cream and black (see `zine` theme's `semanticOverrides` in `client/src/themes.ts`) — never a hue a poster wouldn't print in.

## Where this lives in code

- `client/src/themes.ts` — the `zine` theme entry is this direction's canonical token mapping. It is the **default theme** (see `loadThemePrefs`'s fallback) — this is the app's design now, not one option among many; the theme switcher stays in Настройки → Внешний вид only because removing user choice entirely wasn't asked for.
- `client/src/index.css` — global `.card .card` flatten rule, `.audio-player-bar` capsule restyle, `.month-calendar` pencil-underline marks.
- `client/src/components/dnd/AbilitySavesSkills.tsx` — the flip-dice ability/save widget (direction-agnostic component, but the component this world's "roll display" principle is demonstrated through).

## What stays out of scope here

- The **Сказание** (storybook/woodcut) and **Аркада** (arcade cartoon) themes built earlier this session remain as alternate, fully switchable options — this pass does not remove or alter them. Only `zine`'s completeness and default status change.
- No layout/IA changes — page structure, navigation, and routes are untouched; this is a surface-language pass.
