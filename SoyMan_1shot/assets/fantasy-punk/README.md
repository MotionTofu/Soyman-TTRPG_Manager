# Fantasy Punk asset archive

This directory is the canonical source for OneShot visual assets. It contains
concepts, source PNGs, proofs, generated packs and optimized WebP. None of the
archive is served directly by Vite.

`runtime-manifest.json` lists the small production subset currently referenced
by `client/src/fantasy-punk-skin.css`. Run `node SoyMan_1shot/sync-ui-assets.mjs`
from the repository root to copy that subset to `client/public/ui/fantasy-punk`.
Both the main client and OneShot builds perform this step automatically.
`node SoyMan_1shot/sync-ui-assets.mjs --check` verifies CSS URLs, missing or
extra runtime files, byte-identical copies and the size budget without writes.

Do not edit `client/public/ui/fantasy-punk` directly. A new production image
needs a screen-specific role, semantic filename, optimized WebP, CSS reference
and manifest entry. Keep unused concepts, atlases and proofs here.
