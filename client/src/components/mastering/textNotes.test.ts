// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { captureTextSelection, resolveTextAnchor, textAnchorRange, type TextNoteDraft } from "./textNotes";

afterEach(() => { window.getSelection()?.removeAllRanges(); document.body.replaceChildren(); });
describe("привязка заметок к тексту книги", () => {
  it("сохраняет выделение через форматирование и восстанавливает его после смены ширины", () => {
    const root = document.createElement("div"); root.innerHTML = "<p>До <strong>важная</strong> цитата после.</p>"; document.body.append(root);
    const range = document.createRange(); range.setStart(root.querySelector("strong")!.firstChild!, 0); range.setEnd(root.querySelector("p")!.lastChild!, 7);
    window.getSelection()!.addRange(range);
    const draft = captureTextSelection(root)!;
    expect(draft.quote).toBe("важная цитата");
    expect(draft.anchor).toEqual({ start: 3, end: 16 });
    root.innerHTML = "<p>До <em>важная цитата</em> после.</p>";
    expect(textAnchorRange(root, resolveTextAnchor(root.textContent!, draft)!)!.toString()).toBe(draft.quote);
  });
  it("находит перемещённую цитату, но не угадывает неоднозначное совпадение", () => {
    const draft: TextNoteDraft = { quote: "цитата", anchor: { start: 2, end: 8 }, context_before: "А ", context_after: " Б" };
    expect(resolveTextAnchor("Вставка. А цитата Б", { ...draft, needs_reattach: true })).toEqual({ start: 11, end: 17 });
    expect(resolveTextAnchor("А цитата Б; А цитата Б", { ...draft, anchor: { start: 99, end: 105 }, needs_reattach: true })).toBeNull();
    expect(resolveTextAnchor("Удалённый фрагмент", draft)).toBeNull();
    expect(resolveTextAnchor("цитата", { ...draft, anchor: null })).toBeNull();
  });
  it("отбрасывает выделение вне статьи и недопустимый диапазон", () => {
    const root = document.createElement("div"); root.textContent = "Статья"; document.body.append(root);
    const outside = document.createElement("p"); outside.textContent = "Чужое"; document.body.append(outside);
    const range = document.createRange(); range.selectNodeContents(outside); window.getSelection()!.addRange(range);
    expect(captureTextSelection(root)).toBeNull();
    expect(textAnchorRange(root, { start: 20, end: 24 })).toBeNull();
  });
});
