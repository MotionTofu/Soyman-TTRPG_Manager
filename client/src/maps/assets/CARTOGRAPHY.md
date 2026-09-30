# SoyMan Cartography 1

Installed local pack `soyman-cartography`, version `1`. Object references store stable IDs and pack versions, never file URLs. Catalog: `cartography.ts`; shipped media: `client/public/cartography`; provenance and hashes: `cartography-pack.json`.

The 17 source PNGs were generated with OpenAI image_gen on 2026-09-30 in this conversation, at the user's request, for SoyMan's map editor. No third-party stock imagery was imported into this pack and no external stock license is claimed. This provenance is not a public-domain or Creative Commons declaration. The source prompts, PNGs and original manifest remain in the local `.scratch/map-workspace-rebuild/mockups/assets/cartography-v1/` archive.

Technical preparation: crop transparent objects to inspected content bounds plus 8 pixels, resize the longest side to at most 512 pixels, encode WebP at quality 80. Original PNGs were not modified. All 17 files fit the repository's 100 KiB per-file limit; 13 preserve alpha. Mirrored repeating surface tiles are derived in memory from the installed texture; they are not stored in map documents.

13 illustrated objects are exposed in the shelf, with 4 existing vector symbols as alternatives. Stone, earth and water are textures for the existing terrain materials. Stone walls and ordinary doors can use artwork in the paper/ink style without replacing their geometry or game rules. The crypt-guard portrait is packaged as reserve artwork; it never substitutes for a real creature's portrait or identity. Illustrated scatter has separate versioned builtin profiles; old vector profiles retain their artwork and recipes.

Everything is served from local application paths, without a remote CDN or authentication for this built-in pack. Existing authorized resource images remain a separate registry. Image decoding is lazy and announced to the canvas; a failed local image retains its catalog identity, compatible editing and a visible fallback. Failed loads are cached to prevent request loops; a full app reload retries them.

UI typography uses the already bundled Sofia Sans Semi Condensed and Rubik Dirt fonts. Paper and ink styling is scoped to the new workspace. Map style is independent from UI style; blueprint stays free of decorative surface textures.

Mask textures are cached per immutable mask and image, with at most 16 pixels per world unit and 1536 pixels per side. Materials sharing a texture share one alpha clip. The mask cache has an LRU limit of 64 MiB / 128 entries, so undo history cannot retain an unbounded amount of derived artwork. Image levels use a separate 32 MiB / 256 entry LRU cache and retain the source aspect ratio. Caches and scatter instances are transient. The shipping pack is intended as a coherent starter library, not an external asset marketplace or a native Wonderdraft/Dungeondraft importer.
