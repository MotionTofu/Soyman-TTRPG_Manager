import path from "path";
import { randomUUID } from "crypto";
import { createCutsceneDocument, createCutsceneStep, createCutsceneAudioCommand, type CutsceneDocument } from "@soyman/shared";
import { createCutscene, saveCutscene } from "../services/cutscenes";
import { importCutsceneMedia } from "../services/cutsceneMedia";
import { ensureSubfolder, VAULT_ROOT, vaultAbs } from "../services/filesystem";
import fs from "node:fs";

export const cutscenePng = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEUlEQVQImWOwiq75D8IMMAYARXIIQQ6NeZcAAAAASUVORK5CYII=", "base64");
export function cutsceneWav(seconds = 2): Buffer {
  const sampleRate = 8000, bytes = sampleRate * seconds * 2;
  const buffer = Buffer.alloc(44 + bytes);
  buffer.write("RIFF"); buffer.writeUInt32LE(36 + bytes, 4); buffer.write("WAVEfmt ", 8);
  buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24); buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36); buffer.writeUInt32LE(bytes, 40);
  return buffer;
}
export async function cutsceneFiles() {
  const directory = vaultAbs(ensureSubfolder(VAULT_ROOT, `Cutscene-test-sources/${randomUUID()}`));
  const image = path.join(directory, "source.png"), audio = path.join(directory, "source.wav");
  // Tests intentionally replace these sources. Keep mutable fixtures outside the dedup ledger.
  await Promise.all([fs.promises.writeFile(image, cutscenePng), fs.promises.writeFile(audio, cutsceneWav())]);
  return { directory, image, audio };
}
export async function mediaCutscene() {
  const original = createCutscene(createCutsceneDocument("Медиа катсцены"));
  const sources = await cutsceneFiles();
  const image = await importCutsceneMedia(original.id, "image", sources.image, "source.png");
  const audio = await importCutsceneMedia(original.id, "audio", sources.audio, "source.wav");
  const document: CutsceneDocument = { ...original.document, description: "Описание", steps: [{
    ...createCutsceneStep("first"), notes: "Приватная заметка",
    image: { action: "replace", transition: { kind: "black", durationMs: 900 }, composition: {
      background: { kind: "image", id: image.ref.id }, title: "Титр", title_secs: 3, fade_ms: 300,
      layers: [{ id: "layer", name: "Слой", position: 0, x_pct: 0, y_pct: 0, w_pct: 50, h_pct: 50,
        visible: false, image: { kind: "image", id: image.ref.id } }],
    } },
    audio: { action: "replace", command: { ...createCutsceneAudioCommand("command", { kind: "audio", id: audio.ref.id }),
      startSeconds: 0.25, endSeconds: 1.5, loop: { enabled: true, transition: { mode: "sequential", fadeInMs: 200, fadeOutMs: 300 } } } },
    text: { action: "replace", text: "**Текст**" },
  }, createCutsceneStep("second")] };
  return { original: saveCutscene(original.id, document), sources, image, audio };
}
