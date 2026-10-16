// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NotesFeed, type FeedItem } from "./NotesFeed";

vi.mock("./mentions/MentionText", () => ({ MentionText: ({ text }: { text: string }) => <span>{text}</span> }));
vi.mock("./mentions/MentionTextarea", () => ({ MentionTextarea: () => <textarea /> }));
afterEach(cleanup);

const items: FeedItem[] = [{ kind: "note", key: "n1", id: 1, text: "Хор помогает", created_at: "2026-10-01 20:00:00" }];
const noop = { onSend: async () => true, onEdit: async () => true, onDelete: () => {} };

describe("«→ в черновик» в ленте", () => {
  it("без onToDraft (пульт) кнопки нет", () => {
    render(<NotesFeed items={items} loaded emptyText="" {...noop} />);
    expect(screen.queryByRole("button", { name: "→ в черновик" })).toBeNull();
  });

  it("с onToDraft («Итоги») — отдаёт сообщение", () => {
    const onToDraft = vi.fn();
    render(<NotesFeed items={items} loaded emptyText="" {...noop} onToDraft={onToDraft} />);
    fireEvent.click(screen.getByRole("button", { name: "→ в черновик" }));
    expect(onToDraft).toHaveBeenCalledWith(1, "Хор помогает");
  });
});
