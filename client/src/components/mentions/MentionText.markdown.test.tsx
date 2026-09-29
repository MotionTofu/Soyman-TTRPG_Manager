// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { api } from "../../api/client";
import { MentionText } from "./MentionText";
import { MentionTextarea } from "./MentionTextarea";

afterEach(() => vi.restoreAllMocks());

describe("compatible Markdown prose", () => {
  it("keeps UID links inside GFM tables and supports old styled runs", () => {
    const text = '| Кто | Где |\n| --- | --- |\n| [[being@123456789abc|home|Мирт]] | {span color="#aa3300"}Север{/span} |';
    const { container } = render(<MentionText text={text} mentionsAsBold />);
    expect(container.querySelectorAll("td")).toHaveLength(2);
    expect(container.querySelector("td strong")?.textContent).toBe("Мирт");
    expect(screen.getByText("Север").closest("span[style]")?.getAttribute("style")).toContain("color");
  });

  it("renders GFM and old quote syntax while keeping single line breaks", () => {
    const text = '# Заголовок\n\nПервый\nвторой\n\n{quote}Старая цитата{/quote}\n\n> Новая цитата\n\n- [x] готово\n- [ ] позже\n\n~~устарело~~ и `код`';
    const { container } = render(<MentionText text={text} />);
    expect(container.querySelector(".rt-h1")?.textContent).toBe("Заголовок");
    expect(container.querySelector(".rt-md-paragraph")?.textContent).toContain("Первый\nвторой");
    expect(container.querySelectorAll(".rt-quote")).toHaveLength(2);
    expect(container.querySelectorAll('input[type="checkbox"]')).toHaveLength(2);
    expect(container.querySelector("del")?.textContent).toBe("устарело");
    expect(container.querySelector("code")?.textContent).toBe("код");
  });

  it("shows raw HTML as text without creating active elements", () => {
    const { container } = render(<MentionText text={'<script>alert(1)</script>\n\n[опасно](javascript:alert(1)) и [пока без пути](other.md)'} />);
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("a")).toBeNull();
    expect(container.textContent).toContain("<script>alert(1)</script>");
  });

  it("keeps nested old formatting and Markdown escapes", () => {
    const { container } = render(<MentionText text={'{quote}До {span color="#aa3300"}**важно**{/span} после{/quote}\n\n\\*буквально\\*'} />);
    expect(container.querySelector('.rt-quote strong')?.textContent).toBe('важно');
    expect(container.querySelector('.rt-quote span[style]')).not.toBeNull();
    expect(container.textContent).toContain('*буквально*');
  });

  it("opens a linked Resource and renders its image through the resolved UID", async () => {
    const uid = "12345678-1234-1234-1234-123456789abc";
    vi.spyOn(api, "get").mockResolvedValue([{ uid, id: 42, name: "Карта", type: "image", category: "image", file_url: "/files/map.png?sig=test" }]);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><MentionText text={`[Открыть карту](soyman:resource/${uid}) ![Карта](soyman:resource/${uid})`} /></QueryClientProvider>);
    expect((await screen.findByRole("link", { name: "Открыть карту" })).getAttribute("href")).toBe(`/resources/link/${uid}`);
    expect(screen.getByRole("img", { name: "Карта" }).getAttribute("src")).toBe("/files/map.png?sig=test");
  });

  it("appends a picked Resource when the editor had no cursor yet", () => {
    const change = vi.fn();
    render(<MentionTextarea value="Начало" onChange={change} insertRequest={{ key: 1, text: "[Карта](soyman:resource/12345678-1234-1234-1234-123456789abc)" }} />);
    expect(change).toHaveBeenCalledWith("Начало\n\n[Карта](soyman:resource/12345678-1234-1234-1234-123456789abc)");
  });

  it("keeps an inaccessible Resource visible without a clickable target", async () => {
    const uid = "12345678-1234-1234-1234-123456789abc";
    vi.spyOn(api, "get").mockResolvedValue([]);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><MentionText text={`[Секрет](soyman:resource/${uid})`} /></QueryClientProvider>);
    expect(await screen.findByText(/Ресурс недоступен/)).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Секрет" })).toBeNull();
  });
});
