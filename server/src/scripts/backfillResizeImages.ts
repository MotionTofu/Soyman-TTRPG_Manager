// One-off backfill: re-processes every existing image on disk that predates
// the sharp-resize feature (or was uploaded before a given preset's cap
// existed) down to that preset's max dimensions. Safe to re-run — files
// already within their cap are left untouched (no needless re-encoding).
//
// Run with: npx tsx src/scripts/backfillResizeImages.ts
import fs from "fs";
import sharp from "sharp";
import { applyActiveStorageEnv } from "../services/storages";
applyActiveStorageEnv();
import { db } from "../db/db";
import { IMAGE_SIZE_PRESETS, resizeImageBuffer, type ImageSizePreset } from "../services/imageResize";

interface Target {
  table: string;
  column: string;
  preset: ImageSizePreset;
}

// Every image column in the schema that should be capped — deliberately
// excludes setting_locations.map_image_path (maps stay full-resolution).
const TARGETS: Target[] = [
  { table: "gallery_images", column: "image_path", preset: "gallery" },
  { table: "systems", column: "thumbnail_image_path", preset: "thumbnail" },
  { table: "settings", column: "background_image_path", preset: "background" },
  { table: "settings", column: "thumbnail_image_path", preset: "thumbnail" },
  { table: "campaigns", column: "background_image_path", preset: "background" },
  { table: "campaigns", column: "thumbnail_image_path", preset: "thumbnail" },
  { table: "players", column: "avatar_image_path", preset: "avatar" },
  { table: "players", column: "thumbnail_image_path", preset: "thumbnail" },
  { table: "characters", column: "avatar_image_path", preset: "avatar" },
  { table: "characters", column: "thumbnail_image_path", preset: "thumbnail" },
  { table: "character_chapters", column: "image_path", preset: "thumbnail" },
  { table: "setting_locations", column: "avatar_image_path", preset: "avatar" },
  { table: "setting_locations", column: "thumbnail_image_path", preset: "thumbnail" },
  { table: "setting_beings", column: "avatar_image_path", preset: "avatar" },
  { table: "setting_beings", column: "thumbnail_image_path", preset: "thumbnail" },
  { table: "setting_communities", column: "avatar_image_path", preset: "avatar" },
  { table: "setting_communities", column: "thumbnail_image_path", preset: "thumbnail" },
];

async function backfillFile(
  filePath: string,
  preset: ImageSizePreset
): Promise<{ status: "resized" | "skipped" | "error"; before: number; after: number }> {
  if (!fs.existsSync(filePath)) return { status: "skipped", before: 0, after: 0 };
  const before = fs.statSync(filePath).size;
  try {
    const buffer = fs.readFileSync(filePath);
    const meta = await sharp(buffer).metadata();
    const { width: maxW, height: maxH } = IMAGE_SIZE_PRESETS[preset];
    if (!meta.width || !meta.height || (meta.width <= maxW && meta.height <= maxH)) {
      return { status: "skipped", before, after: before };
    }
    const resized = await resizeImageBuffer(buffer, preset);
    fs.writeFileSync(filePath, resized);
    return { status: "resized", before, after: fs.statSync(filePath).size };
  } catch (err) {
    console.error(`  ! failed on ${filePath}:`, err instanceof Error ? err.message : err);
    return { status: "error", before, after: before };
  }
}

async function main() {
  let totalBefore = 0;
  let totalAfter = 0;
  let resizedCount = 0;
  let errorCount = 0;

  for (const { table, column, preset } of TARGETS) {
    const rows = db
      .prepare(`SELECT ${column} as p FROM ${table} WHERE ${column} IS NOT NULL AND ${column} != ''`)
      .all() as { p: string }[];
    if (rows.length === 0) continue;
    console.log(`${table}.${column} (${rows.length} rows, preset=${preset})`);
    for (const { p } of rows) {
      const result = await backfillFile(p, preset);
      if (result.status === "resized") {
        resizedCount++;
        totalBefore += result.before;
        totalAfter += result.after;
        console.log(`  resized ${p} — ${(result.before / 1024 / 1024).toFixed(1)}MB -> ${(result.after / 1024 / 1024).toFixed(1)}MB`);
      } else if (result.status === "error") {
        errorCount++;
      }
    }
  }

  console.log("\n---");
  console.log(`Resized: ${resizedCount} file(s), errors: ${errorCount}`);
  console.log(
    `Reclaimed: ${((totalBefore - totalAfter) / 1024 / 1024).toFixed(1)}MB (${(totalBefore / 1024 / 1024).toFixed(1)}MB -> ${(totalAfter / 1024 / 1024).toFixed(1)}MB)`
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
