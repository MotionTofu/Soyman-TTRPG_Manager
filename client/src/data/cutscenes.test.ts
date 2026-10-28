import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCutsceneDocument, createCutsceneStep } from "@shared/cutscenes/defaults";
import type { CutsceneOriginal } from "@shared/cutscenes/types";
vi.mock("./hooks", () => ({ write: { put: vi.fn(), post: vi.fn(), del: vi.fn() } }));
vi.mock("./imperative", () => ({ afterWriteAnywhere: vi.fn(), readOnce: vi.fn() }));
import { write } from "./hooks";
import { afterWriteAnywhere, readOnce } from "./imperative";
import { cutsceneCatalogParams, cutscenePaths, cutscenes, parseCutsceneCatalogFilter, updateCutsceneCatalogParams } from "./cutscenes";
import { dataKeys, matchesAffect } from "./entities";
import { queryClient } from "./queryClient";

const original = (): CutsceneOriginal => ({ id: 11, savedVersion: "version", createdAt: "2026-10-26", updatedAt: "2026-10-26", archivedAt: null,
  document: { ...createCutsceneDocument("Город"), steps: [createCutsceneStep("one")] } });
beforeEach(() => { vi.resetAllMocks(); vi.mocked(write.post).mockResolvedValue(original()); vi.mocked(write.put).mockResolvedValue(original()); vi.mocked(readOnce).mockResolvedValue(original()); });
afterEach(() => queryClient.clear());
describe("слой каталога катсцен", () => {
  it("использует согласованные начальные фильтры API", () => {
    expect(parseCutsceneCatalogFilter(new URLSearchParams())).toEqual({ search: "", campaignId: null, archive: "active", sort: "updated", order: "desc" });
  });
  it("поиск, кампания, архив и сортировка проходят через URL без потери русских букв", () => {
    const filter = parseCutsceneCatalogFilter(new URLSearchParams("search=  НОЧЬ  &campaignId=12&archive=archived&sort=name&order=desc"));
    expect(parseCutsceneCatalogFilter(cutsceneCatalogParams(filter))).toEqual({ ...filter, search: "НОЧЬ" });
    expect(cutscenePaths.catalog(filter)).toContain("campaignId=12");
  });
  it("некорректные параметры не уходят в API как неподдерживаемые фильтры", () => {
    expect(parseCutsceneCatalogFilter(new URLSearchParams("campaignId=-1&archive=bad&sort=bad&order=bad"))).toEqual(parseCutsceneCatalogFilter(new URLSearchParams()));
  });
  it("быстрая смена поиска и фильтра до commit навигации не возвращает старый ввод", () => {
    const current = new URLSearchParams("search=старое&archive=active&sort=name");
    updateCutsceneCatalogParams(current, { search: "Новое  " }); updateCutsceneCatalogParams(current, { archive: "archived" });
    expect(current.get("search")).toBe("Новое  "); expect(current.get("archive")).toBe("archived");
  });
  it("создаёт сохраняемый пустой черновик и обновляет только область катсцен", async () => {
    await cutscenes.create("  Новая  ", "Описание");
    expect(write.post).toHaveBeenCalledWith("/cutscenes", { document: { ...createCutsceneDocument("Новая"), description: "Описание" } });
    expect(afterWriteAnywhere).toHaveBeenCalledWith([{ path: "/cutscenes" }, { path: "/archive" }]);
    expect(queryClient.getQueryData(dataKeys.resource("/cutscenes/11"))).toEqual(original());
  });
  it("архив и восстановление обновляют оригинал, каталог и общий архив", async () => {
    vi.mocked(write.del).mockResolvedValue(original()); await cutscenes.archive(11); await cutscenes.restore(11);
    expect(write.del).toHaveBeenCalledExactlyOnceWith("/cutscenes/11"); expect(write.put).toHaveBeenCalledWith("/cutscenes/11/restore");
    expect(afterWriteAnywhere).toHaveBeenCalledWith([{ path: "/cutscenes" }, { path: "/archive" }]);
  });
  it("восстановление и удаление в архиве обновляют открытый каталог", () => {
    expect(matchesAffect(dataKeys.resource("/cutscenes?archive=active"), { path: "/archive" })).toBe(true);
    expect(matchesAffect(dataKeys.resource("/archive"), { path: "/cutscenes" })).toBe(true);
  });
  it("дублирование использует независимую операцию 03 без передачи привязок", async () => {
    await cutscenes.duplicate(11); expect(write.post).toHaveBeenCalledWith("/cutscenes/11/duplicate");
  });
  it("перед правкой метаданных читает актуальные шаги и настройки", async () => {
    const latest = original(); vi.mocked(readOnce).mockResolvedValue({ ...latest, document: { ...latest.document, steps: [createCutsceneStep("from-another-window")] } });
    await cutscenes.updateMetadata(11, { description: "Новый текст" });
    expect(write.put).toHaveBeenCalledWith("/cutscenes/11", { document: { ...latest.document, description: "Новый текст", steps: [createCutsceneStep("from-another-window")] } });
  });
  it("записи одного оригинала сериализуются; неудача не блокирует следующую", async () => {
    let reject!: (reason: Error) => void;
    const entered = new Promise<void>(resolve => vi.mocked(write.put).mockImplementationOnce(() => { resolve(); return new Promise((_ok, fail) => { reject = fail; }); }));
    const first = cutscenes.save(11, original().document).catch(() => null); await entered;
    const second = cutscenes.updateMetadata(11, { name: "Позже" });
    expect(readOnce).not.toHaveBeenCalled(); reject(Error("offline")); await first; await second;
    expect(readOnce).toHaveBeenCalledTimes(1); expect(write.put).toHaveBeenCalledTimes(2);
  });
  it("автосохранение накладывает изменённые поля на свежий документ", async () => {
    const base=original().document, latest={...original(),document:{...base,description:'Чужое описание',steps:[{...base.steps[0],notes:'Новые заметки'}]}};
    vi.mocked(readOnce).mockResolvedValue(latest);await cutscenes.saveDraft(11,base,{...base,name:'Наше имя'});
    expect(write.put).toHaveBeenCalledWith('/cutscenes/11',{document:{...latest.document,name:'Наше имя'}});
  });
  it("несохранённый ответ не попадает в кэш последней успешной версии", async () => {
    const before=original();queryClient.setQueryData(dataKeys.resource('/cutscenes/11'),before);vi.mocked(write.put).mockRejectedValueOnce(Error('offline'));
    await expect(cutscenes.saveDraft(11,before.document,{...before.document,name:'Не сохранено'})).rejects.toThrow('offline');
    expect(queryClient.getQueryData(dataKeys.resource('/cutscenes/11'))).toEqual(before);expect(afterWriteAnywhere).not.toHaveBeenCalled();
  });
  it("поздний GET не заменяет более новую подтверждённую запись", async () => {
    let complete!:(value:CutsceneOriginal)=>void;const before=original(),newer={...before,savedVersion:'newer',document:{...before.document,name:'Новее'}};
    const pending=queryClient.fetchQuery({queryKey:dataKeys.resource('/cutscenes/11'),queryFn:()=>new Promise<CutsceneOriginal>(resolve=>{complete=resolve;})}).catch(()=>null);
    vi.mocked(write.put).mockResolvedValue(newer);await cutscenes.saveDraft(11,before.document,newer.document);complete(before);await pending;
    expect(queryClient.getQueryData(dataKeys.resource('/cutscenes/11'))).toEqual(newer);
  });
  it.each([["/cutscenes?archive=active", true], ["/cutscenes/11/thumbnail", true], ["/campaigns/3/cutscenes", true],
    ["/sessions/8/cutscenes", true], ["/campaigns/3", false], ["/sessions/8/story-tree", false], ["/resources", false]])("адресное обновление %s → %s", (path, expected) => {
    expect(matchesAffect(dataKeys.resource(path), { path: "/cutscenes" })).toBe(expected);
  });
});
