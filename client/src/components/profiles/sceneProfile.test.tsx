// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
// @ts-expect-error Node fs доступен раннеру тестов; клиентские типы Node не подключаются.
import { readFileSync } from "node:fs";
import { useTabState } from "../../hooks/useTabState";
import { TYPE_COLORS } from "../../graphTypes";
import type { SceneSession, StorySceneDetail } from "../../types";
import { SCENE_TABS, SCENE_TAB_ALIASES, SceneLinks, groupClueTargets } from "./SceneProfile";
import { originalSceneHref, sceneSession } from "./sceneProgress";
import { profileColor } from "./ProfileParts";

vi.mock("../../data/hooks", () => ({ useResource: (url: string) => ({ data: url.includes("incoming") ? { transitions: [], outcomes: [] } : [] }), useAction: () => vi.fn(), write: {} }));
vi.mock("../../hooks/useIsMobile", () => ({ useIsMobile: () => false }));
vi.mock("../presentation/PresentationEditor", () => ({ PresentationEditor: () => null }));
vi.mock("../presentation/AddSceneMaterial", () => ({ AddSceneMap: () => null, AddScenePicture: () => null }));

function Tab() { const [tab] = useTabState(SCENE_TABS, "Лист", SCENE_TAB_ALIASES); return <span>{tab}</span>; }
describe("сцена «Д»", () => {
  it.each(["Представление", "Карта", "Аудионабор"])("старый URL %s открывает Материалы", (tab) => {
    expect(renderToStaticMarkup(<MemoryRouter initialEntries={[`/scenes/472?tab=${encodeURIComponent(tab)}`]}><Tab /></MemoryRouter>)).toContain("Материалы");
  });
  it("оставляет пояснение у пустой стартовой сцены, скрывает входы у обычной", () => {
    const scene = { id: 472, node_role: "start", transitions: [] } as unknown as StorySceneDetail;
    const html = (s: StorySceneDetail) => renderToStaticMarkup(<MemoryRouter><SceneLinks scene={s} campaignId={null} clues={{ outgoing: [], incoming: [] }} /></MemoryRouter>);
    expect(html(scene)).toContain("Стартовая сцена — улики сюда не нужны");
    expect(html({ ...scene, node_role: "normal" })).not.toContain("Ведут сюда");
    expect(html(scene).match(/\+ Улика/g)).toHaveLength(1);
  });
  it("чип правки ведёт в исходную сцену без кампании", () => {
    expect(originalSceneHref({ id: 900, source_scene_id: 472 })).toBe("/scenes/472");
  });
  it("выбирает сессию по общему правилу «Сюжета»", () => {
    const sessions: SceneSession[] = [{ id: 1, date: "2026-01-01", number: 1, played: true }, { id: 2, date: "2099-01-01", number: 2, played: false }, { id: 3, date: "2026-02-01", number: 3, played: true }];
    expect(sceneSession({ sessions }).label).toBe("Сессия №3");
    expect(sceneSession({ sessions: sessions.filter((s) => !s.played) }).label).toBe("в сессии №2");
    expect(sceneSession({ sessions: [] }).label).toBeNull();
  });
  it("корешок/ярлык/маркеры приключения используют тему, палитра графа прежняя", () => {
    expect(profileColor("adventure")).toBe("var(--type-adventure)");
    const css = readFileSync("src/components/profiles/profiles.css", "utf8");
    expect(css).toContain(`--type-adventure: ${TYPE_COLORS.adventure}`);
    expect(css).toMatch(/\[data-theme-mode="dark"\] \.entity-page--profile\s*\{ --type-adventure: #8B7FE0/);
    expect(TYPE_COLORS.adventure).toBe("#332288");
  });
  it("цели улики: своё приключение первым, главы сводятся к приключению, сама сцена не в списке", () => {
    const arcs = [{ id: 1, name: "Первое", parent_id: null }, { id: 2, name: "Своё", parent_id: null }, { id: 3, name: "Глава", parent_id: 2 }];
    const rows = [{ id: 10, name: "а", arc_id: 1 }, { id: 11, name: "я", arc_id: 3 }, { id: 12, name: "б", arc_id: 2 }, { id: 13, name: "в", arc_id: null }];
    const groups = groupClueTargets(rows, arcs, { id: 11, arc_id: 3 });
    expect(groups.map((g) => [g.label, g.scenes.map((s) => s.id)])).toEqual([["Своё · это приключение", [12]], ["Первое", [10]], ["Вне приключений", [13]]]);
  });
});
