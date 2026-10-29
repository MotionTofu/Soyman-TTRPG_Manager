// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SoundLibrarySection, type SoundSection } from "./SoundLibrarySection";
import type { SoundButton } from "../sound/types";
import { sortSounds } from "../sound/librarySort";

const section: SoundSection = { role: "background", title: "Бэкграунд", into: "бэкграунд", hint: "музыка", icon: "music" };
const sound = (id: number, name: string, folderId: number | null = null): SoundButton => ({
  resource_id: id, name, role: "background", folder_id: folderId,
  icon: null, icon_url: null, pinned: false, src: null, missing: false,
});
const sounds = [sound(1, "Янтарь"), sound(2, "Арка"), sound(3, "Буря", 7), sound(4, "Ветер", 7)];
const folders = [{ id: 7, role: "background" as const, name: "Дорога" }];
const durations = new Map([[1, 90], [2, 180], [3, 10], [4, 30]]);
const props = () => ({ section, sounds, folders, durations, uploading: null,
  playingId: null, onPreview: vi.fn(),
  onUpload: vi.fn(), onEdit: vi.fn(), onCreate: vi.fn(), onRename: vi.fn(), onDelete: vi.fn() });
const names = (region: HTMLElement) => Array.from(region.querySelectorAll(".sl-track-name")).map((el) => el.textContent);

beforeEach(() => localStorage.clear());
afterEach(cleanup);

describe("раздел аудиотеки", () => {
  it.each(["background", "ambient", "weather", "stinger"] as const)("Play у звука раздела %s не открывает редактор", (role) => {
    const handlers = props();
    const sample = { ...sound(5, "Прослушка", 7), role, src: "/preview.wav" };
    const view = render(<SoundLibrarySection {...handlers} section={{ ...section, role }}
      folders={[{ ...folders[0], role }]} sounds={[sample]} />);
    fireEvent.click(screen.getByRole("button", { name: "Прослушать: Прослушка" }));
    expect(handlers.onPreview).toHaveBeenCalledWith(sample);
    expect(handlers.onEdit).not.toHaveBeenCalled();
    expect(view.container.querySelector("button button")).toBeNull();
    view.rerender(<SoundLibrarySection {...handlers} section={{ ...section, role }}
      folders={[{ ...folders[0], role }]} sounds={[sample]} playingId={5} />);
    expect(screen.getByRole("button", { name: "Остановить предпрослушивание: Прослушка" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("не запускает предпрослушивание звука без файла", () => {
    const handlers = props();
    render(<SoundLibrarySection {...handlers} sounds={[
      { ...sound(5, "Пропал"), src: "/missing.wav", missing: true }, sound(6, "Без пути"),
    ]} />);
    for (const name of ["Пропал", "Без пути"]) {
      const play = screen.getByRole("button", { name: `Прослушать: ${name}` });
      expect((play as HTMLButtonElement).disabled).toBe(true);
      fireEvent.click(play);
    }
    expect(handlers.onPreview).not.toHaveBeenCalled();
  });

  it("сортирует корень и папки одним выбором, запоминает его после повторного открытия", () => {
    const view = render(<SoundLibrarySection {...props()} />);
    expect(names(view.container)).toEqual(["Арка", "Янтарь", "Буря", "Ветер"]);
    fireEvent.change(screen.getByLabelText("Сортировка: Бэкграунд"), { target: { value: "duration-desc" } });
    expect(names(view.container)).toEqual(["Арка", "Янтарь", "Ветер", "Буря"]);
    view.unmount();
    const reopened = render(<SoundLibrarySection {...props()} />);
    expect((screen.getByLabelText("Сортировка: Бэкграунд") as HTMLSelectElement).value).toBe("duration-desc");
    expect(names(reopened.container)).toEqual(["Арка", "Янтарь", "Ветер", "Буря"]);
  });

  it("не переносит настройку сортировки в другой раздел", () => {
    render(<><SoundLibrarySection {...props()} /><SoundLibrarySection {...props()}
      section={{ ...section, role: "ambient", title: "Эмбиент" }} /></>);
    fireEvent.change(screen.getByLabelText("Сортировка: Бэкграунд"), { target: { value: "name-desc" } });
    expect((screen.getByLabelText("Сортировка: Эмбиент") as HTMLSelectElement).value).toBe("name-asc");
  });

  it("раскрывает папку, открывает редактор и передаёт точную папку действиям", () => {
    const handlers = props();
    render(<SoundLibrarySection {...handlers} />);
    const region = screen.getByRole("region", { name: "Папка: Дорога" });
    fireEvent.click(within(region).getByText("Буря"));
    expect(handlers.onEdit).toHaveBeenCalledWith(3);
    const toggle = within(region).getByRole("button", { name: /^Дорога/ });
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(within(region).queryByText("Буря")).toBeNull();
    fireEvent.click(toggle);
    expect(within(region).getByText("Буря")).toBeTruthy();
    fireEvent.click(within(region).getByLabelText("Переименовать папку «Дорога»"));
    expect(handlers.onRename).toHaveBeenCalledWith(folders[0]);
    const file = new File(["audio"], "test.wav", { type: "audio/wav" });
    fireEvent.change(screen.getByLabelText("Добавить звуки в папку «Дорога»"), { target: { files: [file] } });
    expect(handlers.onUpload).toHaveBeenCalledWith("background", 7, expect.anything());
  });

  it("показывает пустую папку и не теряет звук при исчезнувшей привязке", () => {
    const data = props();
    const view = render(<SoundLibrarySection {...data} sounds={[sound(10, "Сирота", 999)]} />);
    expect(names(view.container)).toEqual(["Сирота"]);
    expect(within(screen.getByRole("region", { name: "Папка: Дорога" })).getByText("Пока пусто.")).toBeTruthy();
  });

  it("сортирует названия без учёта регистра и с естественным порядком чисел", () => {
    const list = [sound(1, "Трек 10"), sound(2, "трек 2"), sound(3, "Арка")];
    expect(sortSounds(list, "name-asc", new Map()).map((s) => s.name)).toEqual(["Арка", "трек 2", "Трек 10"]);
    expect(list[0].name).toBe("Трек 10");
  });

  it.each(["duration-asc", "duration-desc"] as const)("ставит неизвестное время и пропавшие файлы в конец при %s", (sort) => {
    const list = [sound(1, "А"), { ...sound(2, "Б"), missing: true }, sound(3, "В"), sound(4, "Г")];
    const result = sortSounds(list, sort, new Map([[1, 0], [2, 100], [3, 10]])).map((s) => s.resource_id);
    expect(result).toEqual(sort === "duration-asc" ? [1, 3, 2, 4] : [3, 1, 2, 4]);
  });
});
