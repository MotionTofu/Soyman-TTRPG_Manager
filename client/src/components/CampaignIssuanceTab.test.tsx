// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { CampaignIssuanceTab } from "./CampaignIssuanceTab";

const fixtures = vi.hoisted(() => ({
  sections: [{ id: 1, campaign_id: 1, name: "Записки", kind: "articles", position: 0, created_at: "2026-10-01" }, { id: 2, campaign_id: 1, name: "Портреты", kind: "gallery", position: 1, created_at: "2026-10-01" }],
  articles: [{ id: 11, section_id: 1, title: "Записка", content: "Тело записки", position: 0, created_at: "2026-10-02" }],
  images: [{ id: 21, caption: "Портрет", image_url: "/files/portrait.webp", created_at: "2026-10-03" }],
  summary: [{ target_type: "setting_location", target_id: 31, name: "Район Доков", all: false, players: [{ id: 1, name: "Майк", access_level: "open" }] }],
  readPreview: vi.fn(),
}));
vi.mock("../data/hooks", () => ({
  useResource: (path: string) => ({ data: path.startsWith("/gallery?") ? fixtures.images : path.includes("/articles") ? fixtures.articles : path.startsWith("/campaign-player-sections?") ? fixtures.sections : path.startsWith("/visibility-grants/summary") ? fixtures.summary : path.startsWith("/setting-locations/31") ? { description: "Описание доков" } : [], loading: false, error: null, reload: vi.fn() }),
  useAction: () => vi.fn(), resourceQuery: () => ({}), write: { post: vi.fn(), put: vi.fn(), del: vi.fn() },
}));
vi.mock("@tanstack/react-query", async (importOriginal) => ({ ...await importOriginal<typeof import("@tanstack/react-query")>(), useQueryClient: () => ({}), useQueries: () => [{ data: fixtures.images.filter(image => !(image as { archived_at?: string }).archived_at), isPending: false }] }));
vi.mock("../hooks/useConfirm", () => ({ useConfirm: () => [null, vi.fn()] }));
vi.mock("./PlayerVisibilityPicker", () => ({ PlayerVisibilityPicker: ({ targetType, targetId }: { targetType: string; targetId: number }) => <button aria-label={`Видимость ${targetType}:${targetId}`}>Глаз</button> }));
vi.mock("./GalleryTab", () => ({ GalleryTab: ({ focusedId }: { focusedId?: number }) => <div data-testid="gallery-preview">Изображение {focusedId}</div> }));
vi.mock("./mentions/MentionText", () => ({ MentionText: ({ text }: { text: string }) => <span>{text}</span> }));
vi.mock("../data/imperative", async (importOriginal) => ({ ...await importOriginal<typeof import("../data/imperative")>(), readResource: fixtures.readPreview }));
vi.mock("./player/settingReaderEntries", () => ({ buildSettingReaderGroups: () => [] }));
afterEach(cleanup);

function mountHandouts() {
  render(<MemoryRouter><CampaignIssuanceTab campaignId={1} settingId={1} roster={[]} /></MemoryRouter>);
  fireEvent.click(screen.getByRole("tab", { name: /^Раздатка/ }));
}
describe("колонки выдачи кампании", () => {
  it("hides archived handouts and offers no local archive buttons", () => {
    fixtures.articles.push({ id: 12, section_id: 1, title: "Archived article", content: "Archived", position: 1, created_at: "2026-10-02", archived_at: "2026-10-04" } as never);
    fixtures.images.push({ id: 22, caption: "Archived image", image_url: "/files/archive.webp", created_at: "2026-10-03", archived_at: "2026-10-04" } as never);
    try {
      mountHandouts();
      expect(screen.queryByText("Archived article")).toBeNull();
      expect(screen.queryByRole("button", { name: /^Архив(?: |$)/ })).toBeNull();
      fireEvent.click(within(screen.getByRole("navigation", { name: "Разделы выдачи" })).getByRole("button", { name: /Портреты/ }));
      expect(screen.queryByText("Archived image")).toBeNull();
      expect(screen.queryByRole("button", { name: /^Архив(?: |$)/ })).toBeNull();
    } finally {
      fixtures.articles.pop();
      fixtures.images.pop();
    }
  });
  it("автоматически открывает превью при выборе игрока в верхней строке", async () => {
    fixtures.readPreview.mockResolvedValue({ sections: [], setting: {}, flagged: {} });
    render(<MemoryRouter><CampaignIssuanceTab campaignId={1} settingId={1} roster={[{ id: 7, name: "Марина" } as never]} /></MemoryRouter>);
    const select = screen.getByRole("combobox", { name: "Игрок для предпросмотра" });
    expect(select.closest(".issuance-roots")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Показать" })).toBeNull();
    fireEvent.change(select, { target: { value: "7" } });
    expect(fixtures.readPreview).toHaveBeenCalledWith("/visibility-grants/preview?campaign_id=1&player_id=7", { fresh: true });
    expect(await screen.findByRole("heading", { name: "Глазами игрока — Марина" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Закрыть" }));
    expect((select as HTMLSelectElement).value).toBe("");
  });
  // Макет Camp-Issuance: превью сущности сбоку нет — имя строки ведёт в профиль.
  it("показывает сводку мест строками со ссылкой на сущность", () => {
    render(<MemoryRouter><CampaignIssuanceTab campaignId={1} settingId={1} roster={[]} /></MemoryRouter>);
    expect(within(screen.getByRole("navigation", { name: "Виды сущностей" })).getByRole("button", { name: /Места/ })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Район Доков" }).getAttribute("href")).toBe("/locations/31");
  });
  it("открывает сводку по разделу и тело по статье; действия раздела доступны в сводке", () => {
    mountHandouts();
    expect(screen.getByRole("button", { name: "Редактировать название" })).toBeTruthy();
    expect(screen.getByLabelText("Статей: 1")).toBeTruthy();
    expect(screen.getByText(/Добавлено/)).toBeTruthy();
    const nav = screen.getByRole("navigation", { name: "Содержимое раздела" });
    fireEvent.click(within(nav).getByRole("button", { name: "Записка" }));
    expect(screen.getByText("Тело записки")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "+ Статья" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Редактировать название" })).toBeNull();
    fireEvent.click(within(screen.getByRole("navigation", { name: "Разделы выдачи" })).getByRole("button", { name: /Записки/ }));
    expect(screen.getByRole("button", { name: "Редактировать название" })).toBeTruthy();
  });

  it("редактирует название карандашом и держит действия в заголовке", () => {
    mountHandouts();
    const edit = screen.getByRole("button", { name: "Редактировать название" });
    const header = edit.closest(".issuance-section__header")!;
    expect(within(header as HTMLElement).getByRole("button", { name: "Архивировать раздел" })).toBeTruthy();
    expect((within(header as HTMLElement).getByRole("button", { name: "Переместить выше" }) as HTMLButtonElement).disabled).toBe(true);
    expect((within(header as HTMLElement).getByRole("button", { name: "Переместить ниже" }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(edit);
    expect((screen.getByRole("textbox", { name: "Название раздела" }) as HTMLInputElement).value).toBe("Записки");
    fireEvent.change(screen.getByRole("textbox", { name: "Название раздела" }), { target: { value: "Новое название" } });
    fireEvent.click(screen.getByRole("button", { name: "Отмена" }));
    expect(screen.queryByRole("textbox", { name: "Название раздела" })).toBeNull();
  });

  it("показывает действия статьи в порядке стрелки, видимость, название, архив", () => {
    mountHandouts();
    const edit = screen.getByRole("button", { name: "Редактировать название — Записка" });
    const actions = edit.closest(".issuance-section__actions") as HTMLElement;
    expect(within(actions).getAllByRole("button").map(button => button.getAttribute("aria-label"))).toEqual([
      "Переместить выше — Записка", "Переместить ниже — Записка", "Видимость campaign_player_article:11", "Редактировать название — Записка", "Архивировать статью — Записка",
    ]);
    expect((within(actions).getByRole("button", { name: "Переместить выше — Записка" }) as HTMLButtonElement).disabled).toBe(true);
    expect((within(actions).getByRole("button", { name: "Переместить ниже — Записка" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(edit);
    expect((screen.getByRole("textbox", { name: "Название статьи" }) as HTMLInputElement).value).toBe("Записка");
    fireEvent.click(screen.getByRole("button", { name: "Отмена" }));
    expect(screen.queryByRole("textbox", { name: "Название статьи" })).toBeNull();
  });

  it("показывает список изображений с видимостью и выбранное изображение справа", () => {
    mountHandouts();
    fireEvent.click(within(screen.getByRole("navigation", { name: "Разделы выдачи" })).getByRole("button", { name: /Портреты/ }));
    expect(screen.getByLabelText("Изображений: 1")).toBeTruthy();
    expect(screen.queryByText("Изображений: 1")).toBeNull();
    expect(screen.getByRole("button", { name: "Открыть изображение — Портрет" }).querySelector("img")?.getAttribute("src")).toBe("/files/portrait.webp");
    expect(screen.getByRole("button", { name: "Видимость campaign_player_image:21" })).toBeTruthy();
    const editImage = screen.getByRole("button", { name: "Редактировать название — Портрет" });
    const actions = editImage.closest(".issuance-section__actions") as HTMLElement;
    expect(within(actions).getAllByRole("button").map(button => button.getAttribute("aria-label"))).toEqual(["Переместить выше — Портрет", "Переместить ниже — Портрет", "Видимость campaign_player_image:21", "Редактировать название — Портрет", "Архивировать изображение — Портрет"]);
    fireEvent.click(editImage);
    expect((screen.getByRole("textbox", { name: "Название изображения" }) as HTMLInputElement).value).toBe("Портрет");
    fireEvent.click(screen.getByRole("button", { name: "Отмена" }));
    fireEvent.click(within(screen.getByRole("navigation", { name: "Содержимое раздела" })).getByRole("button", { name: "Портрет" }));
    expect(screen.getByTestId("gallery-preview").textContent).toContain("21");
    const header = screen.getByRole("button", { name: "Архивировать изображение" }).closest(".issuance-image-header") as HTMLElement;
    expect(within(header).getByText(/Добавлено/)).toBeTruthy();
    expect(within(header).getByRole("button", { name: "Видимость campaign_player_image:21" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "+ Изображение" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Редактировать название" })).toBeNull();
  });
});
