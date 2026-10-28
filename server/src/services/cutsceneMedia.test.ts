import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import sharp from "sharp";
import { createCutsceneDocument } from "@soyman/shared";
import { db } from "../db/db";
import { createCutscene, readCutscene, saveCutscene } from "./cutscenes";
import { accessCutsceneMedia, checkCutsceneMedia, collectCutsceneMedia, cutsceneMediaSource, documentMediaRefs,
  importCutsceneMedia, listCutsceneMedia, recoverCutsceneMediaUploads, releaseCutsceneMedia, retainCutsceneMedia } from "./cutsceneMedia";
import { duplicateCutscene } from "./cutsceneDuplicate";
import { ensureSubfolder, VAULT_ROOT, vaultAbs } from "./filesystem";
import { verifySignedUrl } from "./signedUrl";
import { cutsceneFiles, mediaCutscene } from "../test/cutsceneFiles";

afterEach(() => { vi.restoreAllMocks(); });
function file(id: string): string {
  return vaultAbs((db.prepare("SELECT file_path FROM cutscene_media WHERE id = ?").get(id) as { file_path: string }).file_path);
}

describe("независимые версии и срок жизни медиа", () => {
  it("принимает AVIF, который Sharp обозначает контейнером heif с кодеком av1", async () => {
    const original = createCutscene(createCutsceneDocument("AVIF"));
    const directory = vaultAbs(ensureSubfolder(VAULT_ROOT, `Cutscene-test-sources/${randomUUID()}`));
    const source = path.join(directory, "source.avif");
    await sharp({ create: { width: 2, height: 2, channels: 3, background: "#3a5b7c" } }).avif().toFile(source);
    const imported = await importCutsceneMedia(original.id, "image", source, "source.avif");
    expect(imported.mime).toBe("image/avif");
    expect(file(imported.ref.id)).toMatch(/\.avif$/);
  });
  it("сохраняет изображение и аудио после замены и удаления исходных файлов", async () => {
    const { original, sources, image, audio } = await mediaCutscene();
    const storedImage = file(image.ref.id), storedAudio = file(audio.ref.id);
    fs.renameSync(sources.image, `${sources.image}.old`);
    fs.writeFileSync(sources.image, "replacement");
    fs.unlinkSync(sources.audio);
    const result = await checkCutsceneMedia(original.document);
    expect(result.readiness.ready).toBe(true);
    expect(result.checks.find(check => check.ref.kind === "audio")?.durationSeconds).toBe(2);
    expect(fs.readFileSync(storedImage)).toEqual(fs.readFileSync(`${sources.image}.old`));
    expect(fs.statSync(storedAudio).size).toBeGreaterThan(44);
    expect(storedImage).not.toBe(sources.image);
  });

  it("удерживает старую версию снимком, итоговым кадром и музыкой независимо", async () => {
    const { original, image, audio } = await mediaCutscene();
    const imagePath = file(image.ref.id), audioPath = file(audio.ref.id);
    const snapshot = { kind: "snapshot", key: `run-${original.id}` } as const;
    const frame = { kind: "frame", key: `frame-${original.id}` } as const;
    const music = { kind: "music", key: `music-${original.id}` } as const;
    retainCutsceneMedia(snapshot, documentMediaRefs(original.document));
    retainCutsceneMedia(frame, [image.ref]); retainCutsceneMedia(music, [audio.ref]);
    saveCutscene(original.id, { ...original.document, steps: [] });
    collectCutsceneMedia(original.id);
    expect(fs.existsSync(imagePath) && fs.existsSync(audioPath)).toBe(true);
    releaseCutsceneMedia(snapshot); collectCutsceneMedia(original.id);
    expect(fs.existsSync(imagePath) && fs.existsSync(audioPath)).toBe(true);
    releaseCutsceneMedia(frame); collectCutsceneMedia(original.id);
    expect(fs.existsSync(imagePath)).toBe(false); expect(fs.existsSync(audioPath)).toBe(true);
    releaseCutsceneMedia(music); releaseCutsceneMedia(music);
    collectCutsceneMedia(original.id);
    expect(fs.existsSync(audioPath)).toBe(false); expect(listCutsceneMedia(original.id)).toEqual([]);
  });

  it("отказ сохранения чужой/отсутствующей ссылки не меняет документ и удержания", async () => {
    const { original, image } = await mediaCutscene();
    const other = createCutscene(createCutsceneDocument("Другой оригинал"));
    expect(() => saveCutscene(other.id, original.document)).toThrow();
    expect(readCutscene(other.id).document.steps).toEqual([]);
    const before = db.prepare("SELECT * FROM cutscene_media_holds WHERE media_id = ?").all(image.ref.id);
    expect(() => retainCutsceneMedia({ kind: "original", key: String(original.id) }, [{ kind: "image", id: "missing" }])).toThrow();
    expect(db.prepare("SELECT * FROM cutscene_media_holds WHERE media_id = ?").all(image.ref.id)).toEqual(before);
  });

  it("не выдаёт успешный импорт и убирает временные файлы при ошибке записи", async () => {
    const original = createCutscene(createCutsceneDocument("Неудачный импорт"));
    const sources = await cutsceneFiles();
    vi.spyOn(fs, "renameSync").mockImplementationOnce(() => { throw new Error("disk failure"); });
    await expect(importCutsceneMedia(original.id, "image", sources.image, "source.png")).rejects.toThrow("disk failure");
    expect(listCutsceneMedia(original.id)).toEqual([]);
    expect(readCutscene(original.id).document.steps).toEqual([]);
    expect(fs.existsSync(sources.image)).toBe(true);
  });

  it("после перезапуска убирает прерванную загрузку, сохраняя успешные staging и чужие временные файлы", async () => {
    const original = createCutscene(createCutsceneDocument("Прерванная загрузка"));
    const sources = await cutsceneFiles();
    const staged = await importCutsceneMedia(original.id, "image", sources.image, "source.png");
    const pending = randomUUID(), relative = `Cutscenes/media/${pending}.png`;
    fs.writeFileSync(vaultAbs(relative), "partial");
    db.prepare("INSERT INTO cutscene_media VALUES (?, ?, 'image', ?, 'partial', 'image/png', NULL, 'pending', 'date')")
      .run(pending, original.id, relative);
    db.prepare("INSERT INTO cutscene_media_holds VALUES ('staging', ?, ?)").run(String(original.id), pending);
    const uploads = vaultAbs(ensureSubfolder(VAULT_ROOT, ".uploads"));
    const own = path.join(uploads, `cutscene-${randomUUID()}.upload`), other = path.join(uploads, "another-feature.upload");
    fs.writeFileSync(own, "partial"); fs.writeFileSync(other, "other");
    const result = recoverCutsceneMediaUploads();
    expect(result.removed).toContain(pending); expect(fs.existsSync(own)).toBe(false); expect(fs.existsSync(other)).toBe(true);
    expect(listCutsceneMedia(original.id).map(item => item.ref.id)).toEqual([staged.ref.id]);
    fs.unlinkSync(other);
  });

  it("оставляет не удалённый файл в учёте для повторной очистки", async () => {
    const { original, image } = await mediaCutscene();
    saveCutscene(original.id, { ...original.document, steps: [] });
    const unlink = fs.unlinkSync;
    const imagePath = file(image.ref.id);
    vi.spyOn(fs, "unlinkSync").mockImplementation(target => {
      if (String(target) === imagePath) throw Object.assign(new Error("locked"), { code: "EACCES" });
      unlink(target);
    });
    expect(collectCutsceneMedia(original.id).failed).toContain(image.ref.id);
    expect(fs.existsSync(imagePath)).toBe(true);
    vi.restoreAllMocks();
    expect(collectCutsceneMedia(original.id).removed).toContain(image.ref.id);
  });

  it("сохраняет запись о частичной загрузке, если её файл временно заблокирован", async () => {
    const original = createCutscene(createCutsceneDocument("Заблокированная загрузка"));
    const sources = await cutsceneFiles(), rename = fs.renameSync, unlink = fs.unlinkSync;
    let locked = "";
    vi.spyOn(fs, "renameSync").mockImplementationOnce((from, to) => {
      rename(from, to); locked = String(to); throw new Error("post-rename failure");
    });
    vi.spyOn(fs, "unlinkSync").mockImplementation(target => {
      if (String(target) === locked) throw Object.assign(new Error("locked"), { code: "EACCES" });
      unlink(target);
    });
    await expect(importCutsceneMedia(original.id, "image", sources.image, "source.png")).rejects.toThrow("post-rename failure");
    const partial = listCutsceneMedia(original.id);
    expect(partial).toHaveLength(1); expect(partial[0].state).toBe("pending");
    expect(fs.existsSync(locked)).toBe(true);
    vi.restoreAllMocks();
    expect(collectCutsceneMedia(original.id).removed).toContain(partial[0].ref.id);
  });

  it("показывает проблемный шаг и обновляет доступ после истечения подписи", async () => {
    const { original, image } = await mediaCutscene();
    const old = accessCutsceneMedia(original.id, image.ref.id);
    const oldUrl = new URL(old.url, "http://local");
    const now = Date.now(); vi.spyOn(Date, "now").mockReturnValue(now + 61_000);
    expect(verifySignedUrl(oldUrl.pathname, oldUrl.searchParams.get("sig")!, oldUrl.searchParams.get("exp")!)).toBe(false);
    const fresh = accessCutsceneMedia(original.id, image.ref.id);
    const freshUrl = new URL(fresh.url, "http://local");
    expect(verifySignedUrl(freshUrl.pathname, freshUrl.searchParams.get("sig")!, freshUrl.searchParams.get("exp")!)).toBe(true);
    fs.unlinkSync(file(image.ref.id));
    const result = await checkCutsceneMedia(original.document);
    expect(result.readiness.ready).toBe(false);
    if (!result.readiness.ready) expect(result.readiness.issues.some(issue => issue.stepId === "first" && issue.path.includes("image"))).toBe(true);
  });
});

describe("имя материала из Ресурсов", () => {
  it("не удваивает расширение, если оно уже есть в названии", () => {
    const add = (name: string) => Number(db.prepare("INSERT INTO resources (name, category, file_path) VALUES (?, 'audio', 'audio/theme.mp3')").run(name).lastInsertRowid);
    expect(cutsceneMediaSource("audio", { kind: "resource", id: add("Тема.mp3") }).name).toBe("Тема.mp3");
    expect(cutsceneMediaSource("audio", { kind: "resource", id: add("Тема.MP3") }).name).toBe("Тема.MP3");
    expect(cutsceneMediaSource("audio", { kind: "resource", id: add("Тема") }).name).toBe("Тема.mp3");
  });
});

describe("дублирование катсцен", () => {
  it("копирует настройки и медиа, меняет идентичности и не переносит привязки", async () => {
    const { original, sources } = await mediaCutscene();
    const campaign = Number(db.prepare("INSERT INTO campaigns (name) VALUES ('Cutscene duplicate fixture')").run().lastInsertRowid);
    const session = Number(db.prepare("INSERT INTO sessions (campaign_id, date) VALUES (?, '2026-10-25')").run(campaign).lastInsertRowid);
    db.prepare("INSERT INTO campaign_cutscenes VALUES (?, ?)").run(campaign, original.id);
    db.prepare("INSERT INTO session_cutscenes VALUES (?, ?, 0)").run(session, original.id);
    const copy = await duplicateCutscene(original.id);
    expect(copy.id).not.toBe(original.id); expect(copy.savedVersion).not.toBe(original.savedVersion);
    expect(copy.document.name).toBe(`${original.document.name} (копия)`);
    expect(copy.document.settings).toEqual(original.document.settings);
    expect(copy.document.steps[0].notes).toBe(original.document.steps[0].notes);
    expect(copy.document.steps[0].text).toEqual(original.document.steps[0].text);
    expect(copy.document.steps.map(step => step.id)).not.toEqual(original.document.steps.map(step => step.id));
    const copiedAudio = copy.document.steps[0].audio, originalAudio = original.document.steps[0].audio;
    if (copiedAudio.action !== "replace" || originalAudio.action !== "replace") throw new Error("audio fixture");
    expect(copiedAudio.command.id).not.toBe(originalAudio.command.id);
    expect({ ...copiedAudio.command, id: "same", audio: null }).toEqual({ ...originalAudio.command, id: "same", audio: null });
    expect(documentMediaRefs(copy.document).map(ref => ref.id)).not.toEqual(documentMediaRefs(original.document).map(ref => ref.id));
    expect(db.prepare("SELECT * FROM campaign_cutscenes WHERE cutscene_id = ?").all(copy.id)).toEqual([]);
    expect(db.prepare("SELECT * FROM session_cutscenes WHERE cutscene_id = ?").all(copy.id)).toEqual([]);
    saveCutscene(copy.id, { ...copy.document, description: "Правка дубликата" });
    expect(readCutscene(original.id).document.description).toBe("Описание");
    saveCutscene(original.id, { ...original.document, steps: [] }); collectCutsceneMedia(original.id);
    fs.unlinkSync(sources.image); fs.unlinkSync(sources.audio);
    expect((await checkCutsceneMedia(copy.document)).readiness.ready).toBe(true);
  });

  it("ошибка второй копии не публикует частичный оригинал и освобождает первую копию", async () => {
    const { original } = await mediaCutscene();
    const before = (db.prepare("SELECT COUNT(*) n FROM cutscenes").get() as { n: number }).n;
    const rename = fs.renameSync; let count = 0;
    vi.spyOn(fs, "renameSync").mockImplementation((from, to) => {
      if (++count === 2) throw new Error("second copy failed");
      rename(from, to);
    });
    await expect(duplicateCutscene(original.id)).rejects.toThrow("second copy failed");
    expect((db.prepare("SELECT COUNT(*) n FROM cutscenes").get() as { n: number }).n).toBe(before);
    expect(listCutsceneMedia(original.id)).toHaveLength(2);
    expect(db.prepare("SELECT * FROM cutscene_media_holds WHERE holder_key LIKE 'duplicate:%'").all()).toEqual([]);
  });
});
