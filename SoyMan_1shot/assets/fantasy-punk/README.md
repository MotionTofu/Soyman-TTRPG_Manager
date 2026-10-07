# Fantasy Punk asset archive

This directory is the historical source archive for OneShot visual assets. It contains
concepts, source PNGs, proofs, generated packs and optimized WebP. None of the
archive is served directly by Vite.

The editable production masters now live in the shared `assets/library/`,
registered in `assets/manifest.json`. See `assets/README.md` for the searchable
catalog, adoption workflow and safeguards. Do not change an archived WebP
expecting it to update the application automatically.

`runtime-manifest.json` lists the production subset currently referenced
by `client/src/fantasy-punk-skin.css`. Run `node SoyMan_1shot/sync-ui-assets.mjs`
from the repository root to sync the shared library to the runtime locations,
including `client/public/ui/fantasy-punk`.
Both the main client and OneShot builds perform this step automatically.
`node SoyMan_1shot/sync-ui-assets.mjs --check` verifies CSS URLs, missing or
extra runtime files, byte-identical copies and the size budget without writes.

Do not edit `client/public/ui/fantasy-punk` directly. A new production image
needs a screen-specific role, semantic filename, optimized WebP, CSS reference
and entries in the shared manifest and this subset manifest. Keep unused
concepts, atlases and proofs here; put editable production files in the library.
