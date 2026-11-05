// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { SystemDetailPage } from "./SystemDetailPage";

const data = vi.hoisted(() => ({ favourites: [] as {id:number;name:string;kind:string;section_id:number}[] }));
vi.mock("../data/hooks", () => ({ useAction: () => vi.fn(), write: {}, useResource: (path: string) => ({ data:
  path === "/systems/5" ? {id:5,name:"ДнД",code:"phb",description:"Описание"} :
  path === "/systems/5/sections" ? [{id:8,name:"Снаряжение",kind:"equipment"},{id:9,name:"Классы",kind:"class"}] :
  path === "/systems/5/entry-counts" ? [{section_id:8,count:30,class_count:0},{section_id:9,count:715,class_count:14}] :
  path === "/systems/5/entries/favourites" ? data.favourites : [] }) }));
vi.mock("../components/Breadcrumbs", () => ({ Breadcrumbs: () => null }));
vi.mock("../components/SectionBackground", () => ({ SectionBackground: () => null }));
vi.mock("../components/EditableTextCard", () => ({ EditableTextCard: ({value}: {value:string}) => <p>{value}</p> }));
vi.mock("../components/CompendiumSection", () => ({ CompendiumSection: ({focusEntryId}: {focusEntryId:number}) => <p>Запись {focusEntryId}</p> }));
vi.mock("../hooks/useImageCrop", () => ({ useImageCrop: () => ({onSelect:vi.fn(),modal:null}) }));
afterEach(() => { cleanup(); data.favourites = []; });
function show(url = "/systems/5") { return render(<MemoryRouter initialEntries={[url]}><Routes><Route path="/systems/:id" element={<SystemDetailPage />} /></Routes></MemoryRouter>); }
it("сохраняет section/entry и показывает число классов вместо числа всех записей", () => {
  show("/systems/5?section=8&entry=12045");
  expect(screen.getByText("Запись 12045")).toBeTruthy();
  const toc = screen.getByRole("navigation", {name:"Разделы системы"});
  expect(within(toc).getByRole("button", {name:"Классы 14"})).toBeTruthy();
  expect(screen.queryByRole("tablist")).toBeNull();
});
it("закрывает шторку при выборе раздела", () => {
  show();
  fireEvent.click(screen.getByRole("button", {name:/Разделы ▾/}));
  const dialog = screen.getByRole("dialog", {name:"Разделы системы"});
  fireEvent.click(within(dialog).getByRole("button", {name:"Снаряжение 30"}));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.queryByRole("heading", {name:"Частые обращения"})).toBeNull();
});
it("приглашает отметить избранное, а заполненное ведёт на профиль или раскрытие", () => {
  const view = show();
  expect(screen.getByText(/Отметьте ★ записи/)).toBeTruthy();
  view.unmount();
  data.favourites = [{id:12045,name:"Кинжал",kind:"equipment",section_id:8},{id:12191,name:"Воин",kind:"class",section_id:9}];
  show();
  expect(screen.getByRole("link", {name:"Кинжал"}).getAttribute("href")).toBe("/systems/5?section=8&entry=12045");
  expect(screen.getByRole("link", {name:"Воин"}).getAttribute("href")).toBe("/systems/5/entries/12191");
});
