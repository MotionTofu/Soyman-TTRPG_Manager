import { randomUUID } from "crypto";
import type { CutsceneDocument, CutsceneMediaRef } from "@soyman/shared";
import { db } from "../db/db";
import { VAULT_ROOT } from "./filesystem";
import { CutsceneRequestError } from "./cutsceneErrors";
import { createCutscene, readCutscene, saveCutscene } from "./cutscenes";
import {
  collectCutsceneMedia, copyCutsceneMedia, documentMediaRefs, releaseCutsceneMedia, retainCutsceneMedia,
} from "./cutsceneMedia";

export async function duplicateCutscene(id: number) {
  const database = db.prepare("SELECT 1").database, root = VAULT_ROOT;
  const sameStorage = () => database.open && root === VAULT_ROOT && db.prepare("SELECT 1").database === database;
  const source = readCutscene(id);
  const refs = documentMediaRefs(source.document);
  const key = `duplicate:${randomUUID()}`;
  // Synchronous read + retain: edits cannot release a file between those operations.
  retainCutsceneMedia({ kind: "snapshot", key }, refs, id);
  const copies = new Map<string, CutsceneMediaRef>();
  try {
    for (const ref of refs) {
      const copy = await copyCutsceneMedia(id, ref, key);
      if (!sameStorage()) throw new CutsceneRequestError(409, "Хранилище изменилось во время дублирования");
      copies.set(ref.id, copy.ref);
    }
    const replace = (ref: CutsceneMediaRef) => copies.get(ref.id)!;
    const document: CutsceneDocument = {
      ...source.document, name: `${source.document.name} (копия)`,
      steps: source.document.steps.map(step => ({
        ...step, id: randomUUID(),
        image: step.image.action !== "replace" ? step.image : { ...step.image, composition: {
          ...step.image.composition,
          background: step.image.composition.background ? replace(step.image.composition.background) as CutsceneMediaRef<"image"> : null,
          layers: step.image.composition.layers.map(layer => ({ ...layer, id: randomUUID(), image: replace(layer.image) as CutsceneMediaRef<"image"> })),
        } },
        audio: step.audio.action !== "replace" ? step.audio : { ...step.audio, command: {
          ...step.audio.command, id: randomUUID(), audio: replace(step.audio.command.audio) as CutsceneMediaRef<"audio">,
        } },
      })),
    };
    // Publish only after ALL copies succeed. A failed copy never leaves a partial original in the catalogue.
    const result = db.transaction(() => {
      const created = createCutscene({ ...document, steps: [] });
      const adopt = db.prepare("UPDATE cutscene_media SET cutscene_id = ? WHERE id = ?");
      for (const ref of copies.values()) adopt.run(created.id, ref.id);
      const saved = saveCutscene(created.id, document);
      releaseCutsceneMedia({ kind: "staging", key });
      return saved;
    })();
    return result;
  } finally {
    if (sameStorage()) {
      releaseCutsceneMedia({ kind: "staging", key });
      releaseCutsceneMedia({ kind: "snapshot", key });
      collectCutsceneMedia(id);
    }
  }
}
