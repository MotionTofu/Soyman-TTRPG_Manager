// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MasteringPage } from "./MasteringPage";
import type { MasteringBook, MasteringNote, MasteringSection } from "../types";

const mocks = vi.hoisted(() => ({ read: vi.fn(), post: vi.fn(), put: vi.fn(), del: vi.fn(), sync: vi.fn(), confirm: vi.fn() }));
vi.mock("../data/hooks", () => ({
  useResource: (path: string | null) => ({ data: mocks.read(path), loading: false, error: null, reload: vi.fn() }),
  resourceQuery: (path: string) => ({ queryKey: ["covers", path], queryFn: async () => [] }),
  useAction: () => (action: () => Promise<unknown>) => action(),
  write: { post: mocks.post, put: mocks.put, del: mocks.del },
}));
vi.mock("../mentions", () => ({ syncMentionLinks: mocks.sync }));
vi.mock("../api/currentUser", () => ({ getCachedUser: () => ({ id: 1 }) }));
vi.mock("../hooks/useConfirm", () => ({ useConfirm: () => [null, mocks.confirm] }));
vi.mock("../components/PageFrame", () => ({ PageFrame: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock("../components/SectionBackground", () => ({ SectionBackground: () => null }));
vi.mock("../components/EmptyState", () => ({ EmptyState: ({ title, action }: { title: string; action: React.ReactNode }) => <div>{title}{action}</div> }));
vi.mock("../components/mentions/MentionTextarea", () => ({ MentionTextarea: ({ id, value, onChange }: { id?: string; value: string; onChange: (value: string) => void }) => <textarea id={id} value={value} onChange={event => onChange(event.target.value)} /> }));
vi.mock("../components/mentions/MentionText", () => ({ MentionText: ({ text }: { text: string }) => <><span className="rt-h">Первая глава</span><span>{text}</span></> }));
vi.mock("../components/sheet/SheetOverlay", () => ({ SheetOverlay: ({ caption, value, onClose }: { caption: string; value: string; onClose: () => void }) => <div role="dialog" aria-label="A4">{caption}{value}<button onClick={onClose}>Закрыть A4</button></div> }));

let books: MasteringBook[];
let sections: MasteringSection[];
const base = { category: "prep" as const, system_id: null, created_at: "2026-09-30", archived_at: null };
function mount() { return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MasteringPage /></QueryClientProvider>); }

beforeEach(() => {
  localStorage.clear(); vi.clearAllMocks();
  books = Array.from({ length: 20 }, (_, i) => ({ ...base, id: i + 1, section_id: 1, title: `Книга ${i + 1}`, cover_image: null, reading_minutes: 5 }));
  sections = [{ id: 1, category: "prep", name: "Большая полка", system_id: null, created_at: "2026-09-30", position: 0 }, { id: 2, category: "prep", name: "Пустая полка", system_id: null, created_at: "2026-09-30", position: 1 }];
  const details = new Map<number, MasteringNote>();
  mocks.read.mockImplementation((path: string | null) => {
    if (path === "/mastering/sections") return sections;
    if (path === "/systems") return [];
    if (path?.startsWith("/mastering?")) { const params = new URLSearchParams(path.split("?")[1]); return books.filter(book => (!params.get("category") || book.category === params.get("category")) && (!params.get("q") || book.title.includes(params.get("q")!))); }
    if (/^\/mastering\/\d+$/.test(path ?? "")) { const book = books.find(book => book.id === Number(path?.split("/")[2])); if (book && !details.has(book.id)) details.set(book.id, { ...book, content: `Полный текст книги ${book.id}` } as MasteringNote); return book && details.get(book.id); }
    return undefined;
  });
  mocks.post.mockResolvedValue({ id: 101 }); mocks.put.mockResolvedValue({}); mocks.del.mockResolvedValue({}); mocks.confirm.mockResolvedValue(true);
  Object.defineProperty(window, "matchMedia", { configurable: true, value: () => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }) });
  HTMLElement.prototype.scrollIntoView = vi.fn();
  HTMLElement.prototype.scrollBy = vi.fn();
  HTMLElement.prototype.scrollTo = vi.fn();
  URL.createObjectURL = vi.fn(() => "blob:cover-preview");
  URL.revokeObjectURL = vi.fn();
  vi.stubGlobal("requestAnimationFrame", (callback: () => void) => { callback(); return 1; });
  vi.stubGlobal("ResizeObserver", class { callback: () => void; constructor(callback: () => void) { this.callback = callback; } observe(node: HTMLElement) { Object.defineProperty(node, "clientWidth", { configurable: true, value: 600 }); Object.defineProperty(node, "scrollWidth", { configurable: true, value: 3500 }); this.callback(); } disconnect() {} });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("библиотека Мастерения", () => {
  it("переходит по текущему порядку полки, ограничивает края и возвращается к открытой книге", async () => {
    books = books.slice(0, 3).map((book, i) => ({ ...book, title: ["Якорь", "Арка", "Берег"][i] }));
    books.push({ ...base, id: 40, section_id: 2, title: "Соседняя полка", cover_image: null, reading_minutes: 1 });
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Сортировка А–Я: Большая полка" }));
    fireEvent.click(screen.getByRole("button", { name: "Открыть книгу: Якорь" }));
    expect((screen.getByRole("button", { name: "Предыдущая книга" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Следующая книга" }));
    expect(await screen.findByText("Полный текст книги 3")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Следующая книга" }));
    expect(await screen.findByText("Полный текст книги 2")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Следующая книга" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Предыдущая книга" }));
    expect(await screen.findByText("Полный текст книги 3")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "На полку" }));
    expect(screen.getByRole("button", { name: "Открыть книгу: Берег" })).toBeTruthy();
    expect(mocks.read.mock.calls.some(([path]) => path === "/mastering/40")).toBe(false);
  });
  it("сохраняет общую заметку отдельно от текста и переключает представление заметок", async () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Открыть книгу: Книга 1" }));
    fireEvent.click(screen.getByRole("button", { name: "Заметки к книге" }));
    fireEvent.click(screen.getByRole("button", { name: "+ Общая заметка" }));
    fireEvent.change(screen.getByLabelText("Текст заметки"), { target: { value: "Попробовать за игровым столом" } });
    fireEvent.click(screen.getByRole("button", { name: "Сохранить заметку" }));
    await waitFor(() => expect(mocks.post).toHaveBeenCalledWith("/mastering/1/notes", expect.objectContaining({ body: "Попробовать за игровым столом", anchor: null, quote: "" })));
    expect(mocks.put).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Список" }));
    expect(screen.getByRole("button", { name: "Список" }).getAttribute("aria-pressed")).toBe("true");
  });
  it("сортирует русские названия и номера по алфавиту в обоих направлениях", () => {
    const titles = ["Якорь", "Арка 10", "Арка 2", "Берег"];
    books = books.slice(0, 4).map((book, i) => ({ ...book, title: titles[i] }));
    mount();
    const shelf = screen.getByRole("region", { name: "Большая полка" });
    const names = () => within(shelf).getAllByRole("button", { name: /Открыть книгу:/ }).map(node => node.getAttribute("aria-label")?.replace("Открыть книгу: ", ""));
    expect(names()).toEqual(["Арка 2", "Арка 10", "Берег", "Якорь"]);
    fireEvent.click(within(shelf).getByRole("button", { name: "Сортировка А–Я: Большая полка" }));
    expect(names()).toEqual(["Якорь", "Берег", "Арка 10", "Арка 2"]);
    expect(within(shelf).getByRole("button", { name: "Сортировка Я–А: Большая полка" })).toBeTruthy();
  });
  it("загружает отдельную обложку и сохраняет устойчивую ссылку на ресурс", async () => {
    mocks.post.mockImplementation(async (path: string) => path === "/resources" ? { uid: "12345678-1234-1234-1234-123456789abc" } : { id: 101 });
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Добавить книгу на полку Пустая полка" }));
    fireEvent.change(screen.getByLabelText("Название"), { target: { value: "С обложкой" } });
    fireEvent.change(screen.getByLabelText("Оформление"), { target: { value: "custom" } });
    fireEvent.change(screen.getByLabelText("Загрузить обложку"), { target: { files: [new File(["image"], "cover.png", { type: "image/png" })] } });
    fireEvent.click(within(screen.getByRole("dialog", { name: "Новая книга" })).getByRole("button", { name: "Добавить книгу" }));
    await waitFor(() => expect(mocks.post).toHaveBeenCalledWith("/mastering", expect.objectContaining({ cover_image: "soyman:resource/12345678-1234-1234-1234-123456789abc" })));
    expect(mocks.post.mock.calls[0][0]).toBe("/resources");
    expect(mocks.post.mock.calls[0][1]).toBeInstanceOf(FormData);
  });
  it("показывает 20 книг одной полкой, листает и раскрывает её в сетку", () => {
    mount();
    const shelf = screen.getByRole("region", { name: "Большая полка" });
    expect(within(shelf).getAllByRole("button", { name: /Открыть книгу:/ })).toHaveLength(20);
    fireEvent.click(within(shelf).getByRole("button", { name: "Следующие книги: Большая полка" }));
    expect(HTMLElement.prototype.scrollBy).toHaveBeenCalled();
    fireEvent.click(within(shelf).getByRole("button", { name: "Показать все · 20" }));
    expect(shelf.querySelector(".mastering-shelf__track")?.classList.contains("is-expanded")).toBe(true);
    fireEvent.click(within(shelf).getByRole("button", { name: "Свернуть" }));
    expect(shelf.querySelector(".mastering-shelf__track")?.classList.contains("is-expanded")).toBe(false);
  });
  it("загружает полный текст только при открытии книги и сохраняет A4", async () => {
    mount();
    expect(mocks.read.mock.calls.some(([path]) => path === "/mastering/1")).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Открыть книгу: Книга 1" }));
    expect(await screen.findByText("Полный текст книги 1")).toBeTruthy();
    expect(screen.getByRole("navigation", { name: "Оглавление" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "A4" }));
    expect(screen.getByRole("dialog", { name: "A4" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Закрыть A4" }));
    fireEvent.click(screen.getByRole("button", { name: "На полку" }));
    expect(screen.getByRole("button", { name: "Открыть книгу: Книга 20" })).toBeTruthy();
  });
  it("поиск находит книги за пределами ряда и в других категориях", () => {
    books.push({ ...base, id: 30, category: "knowledge", section_id: null, title: "Тайная хроника", cover_image: null, reading_minutes: 2 });
    mount();
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "Тайная" } });
    expect(screen.getByRole("button", { name: "Открыть книгу: Тайная хроника" })).toBeTruthy();
    expect(mocks.read.mock.calls.some(([path]) => String(path).includes("q=") && !String(path).includes("category="))).toBe(true);
  });
  it("позволяет добавить первую книгу на пустую полку", async () => {
    books = []; mount();
    const empty = screen.getByRole("region", { name: "Пустая полка" });
    fireEvent.click(within(empty).getByRole("button", { name: "Добавить книгу" }));
    fireEvent.change(screen.getByLabelText("Название"), { target: { value: "Первая статья" } });
    fireEvent.change(screen.getByLabelText("Текст статьи"), { target: { value: "Сохранённый Markdown" } });
    fireEvent.click(within(screen.getByRole("dialog", { name: "Новая книга" })).getByRole("button", { name: "Добавить книгу" }));
    await waitFor(() => expect(mocks.post).toHaveBeenCalledWith("/mastering", expect.objectContaining({ title: "Первая статья", content: "Сохранённый Markdown", section_id: 2 })));
    expect(mocks.sync).toHaveBeenCalledWith("mastering", 101, "", "Сохранённый Markdown");
  });
  it("редактирует открытый текст, сохраняет ссылки и закладку", async () => {
    mount(); fireEvent.click(screen.getByRole("button", { name: "Открыть книгу: Книга 1" }));
    fireEvent.click(screen.getByRole("button", { name: "Добавить закладку" }));
    expect(JSON.parse(localStorage.getItem("masteringBookBookmarks:1")!)).toEqual([1]);
    fireEvent.click(screen.getByRole("button", { name: "Редактировать книгу" }));
    fireEvent.change(screen.getByLabelText("Текст статьи"), { target: { value: "Исправленный текст" } });
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }));
    await waitFor(() => expect(mocks.put).toHaveBeenCalledWith("/mastering/1", expect.objectContaining({ content: "Исправленный текст" })));
    expect(mocks.sync).toHaveBeenCalledWith("mastering", 1, "Полный текст книги 1", "Исправленный текст");
  });
  it("переносит существующую книгу на другую полку", async () => {
    mount(); const transfer = { effectAllowed: "", setData: vi.fn() };
    fireEvent.dragStart(screen.getByRole("button", { name: "Открыть книгу: Книга 1" }), { dataTransfer: transfer });
    fireEvent.drop(screen.getByRole("region", { name: "Пустая полка" }), { dataTransfer: transfer });
    await waitFor(() => expect(mocks.put).toHaveBeenCalledWith("/mastering/1", { section_id: 2 }));
  });
});
