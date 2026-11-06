// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { CompendiumEntry, SystemSection } from "../types";
import { CompendiumSection } from "./CompendiumSection";
import { DndGroupIndex, DndRegister } from "./DndCompendiumViews";
import { SimpleKindTileGrid } from "./SimpleKindTileGrid";

const fixture = vi.hoisted(()=>({entries:[] as CompendiumEntry[],code:"phb",put:vi.fn().mockResolvedValue({}),sync:vi.fn().mockResolvedValue(undefined)}));
vi.mock("../data/hooks",()=>({useAction:()=>async(fn:()=>Promise<unknown>)=>fn(),write:{put:fixture.put},useResource:(path:string)=>({data:path==="/systems/1" ? {code:fixture.code} : path?.includes("?section_id=") ? fixture.entries : [],reload:vi.fn()})}));
vi.mock("../data/imperative",()=>({readResource:vi.fn().mockResolvedValue([])}));
vi.mock("../dataSync",()=>({notifyDataChanged:vi.fn()}));
vi.mock("../api/currentUser",()=>({useCurrentUser:()=>({user:{id:7}})}));
vi.mock("../compendiumMechanics",async(original)=>{const actual=await original<typeof import("../compendiumMechanics")>();return {...actual,loadMechanicsOptions:()=>Promise.resolve(actual.EMPTY_MECHANICS_OPTIONS)};});
vi.mock("../mentions",async(original)=>({...await original<typeof import("../mentions")>(),syncMentionLinks:fixture.sync}));
vi.mock("./mentions/MentionText",()=>({MentionText:({text}:{text:string})=><span>{text}</span>}));
vi.mock("./mentions/MentionTextarea",()=>({MentionTextarea:({value,onChange,placeholder}:{value:string;onChange:(value:string)=>void;placeholder:string})=><textarea placeholder={placeholder} value={value} onChange={(event)=>onChange(event.target.value)} />}));
vi.mock("./otherscape/powerSetPresentation",async(original)=>({...await original<typeof import("./otherscape/powerSetPresentation")>(),isOtherscapePowerSetsSection:(code:string)=>code==="otherscape",parsePowerSetPresentation:()=>({category:"Mythos",bonus:1})}));
vi.mock("./otherscape/OtherscapePowerSetBody",()=>({OtherscapePowerSetBody:()=><p>Особое тело Otherscape</p>}));

const entry=(patch:Partial<CompendiumEntry>={})=>({id:1,system_id:1,section_id:2,parent_id:null,kind:"equipment",name:"Кинжал",name_original:"Dagger",description:"Текст оружия",level:null,data:{category:"Простое оружие",damage:"1к4 колющий",cost:"2 зм",weight:"1 фнт.",weapon_properties:[{id:11,name:"Фехтовальное [Finesse]"}],weapon_mastery:{id:12,name:"Выпад"}},position:0,...patch} as CompendiumEntry);
beforeEach(()=>{localStorage.clear();fixture.put.mockClear();fixture.sync.mockClear();fixture.code="phb";fixture.entries=[];HTMLElement.prototype.scrollIntoView=vi.fn();});
afterEach(cleanup);
function show(kind="equipment",focus=1){return render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><MemoryRouter initialEntries={["/systems/1?section=2&view=list"]}><CompendiumSection systemId={1} section={{id:2,name:kind==="feat" ? "Черты" : "Снаряжение",kind} as SystemSection} focusEntryId={focus} /></MemoryRouter></QueryClientProvider>);}

it("section/entry раскрывает оружие в статье с цифрами и свойствами",async()=>{
  fixture.entries=[entry()];show();
  const article=await screen.findByRole("article",{name:"Снаряжение: Кинжал"});
  expect(article.textContent).toContain("1к4 колющий");expect(article.textContent).toContain("Фехтовальное");expect(article.textContent).toContain("Выпад");
  expect(article.querySelector("dl.dnd-facts")).toBeTruthy();
  fireEvent.click(within(article).getByRole("button",{name:"Свернуть ▴"}));
  expect(screen.queryByRole("article")).toBeNull();
});
it("черта показывает требование в рамке",async()=>{
  fixture.entries=[entry({kind:"feat",name:"Адепт",data:{category:"Универсальная",prerequisite:"4 уровень, Сотворение заклинаний",ability_increase:{options:["int","wis"],amount:1,max:20},granted_spells:[{id:15,name:"Дребезги",slotCircle:2}]}})];show("feat");
  const article=await screen.findByRole("article",{name:"Черта: Адепт"});
  expect(article.querySelector(".dnd-requirement")?.textContent).toContain("4 уровень, Сотворение заклинаний");
  expect(article.textContent).toContain("+1 к ИНТ, МДР, не выше 20");
  expect(article.textContent).toContain("Дребезги");
});
it("правка из статьи сохраняет прежним PUT и оставляет свойства оружия",async()=>{
  fixture.entries=[entry()];show();
  fireEvent.click(within(await screen.findByRole("article")).getByRole("button",{name:"Править"}));
  fireEvent.change(screen.getByPlaceholderText("Название"),{target:{value:"Свой клинок"}});
  fireEvent.click(screen.getByRole("button",{name:"Сохранить"}));
  await waitFor(()=>expect(fixture.put).toHaveBeenCalledWith("/systems/entries/1",expect.objectContaining({name:"Свой клинок",data:expect.objectContaining({damage:"1к4 колющий",weapon_properties:[{id:11,name:"Фехтовальное [Finesse]"}]})})));
  await waitFor(()=>expect(screen.queryByPlaceholderText("Название")).toBeNull());
});
it("Otherscape сохраняет своё особое тело и не получает статью ДнД",async()=>{
  fixture.code="otherscape";fixture.entries=[entry({kind:"mechanic_item",name:"Сила",description:"Текст набора",data:{}})];show("wiki");
  fireEvent.click(screen.getByRole("button",{name:"Сила"}));
  expect(await screen.findByText("Особое тело Otherscape")).toBeTruthy();
  expect(document.querySelector(".dnd-article")).toBeNull();
});
it("указатель показывает 20 крупнейших групп и раскрывает остаток",()=>{
  const groups=Array.from({length:23},(_,i)=>entry({id:100+i,name:`Группа ${i}`,kind:"mechanic_group"}));
  const children=groups.flatMap((group,i)=>Array.from({length:i},(_,j)=>entry({id:1000+i*30+j,parent_id:group.id})));
  const select=vi.fn();render(<DndGroupIndex groups={groups} entries={[...groups,...children]} onSelect={select} />);
  expect(screen.getAllByRole("button")).toHaveLength(21);
  fireEvent.click(screen.getByRole("button",{name:"Группа 22 22"}));expect(select).toHaveBeenCalledWith(122);
  fireEvent.click(screen.getByRole("button",{name:"ещё 3 групп ▾"}));expect(screen.getAllByRole("button")).toHaveLength(24);
});
it("перенос строки передаёт прежней сортировке группу и обе записи",()=>{
  const first=entry(),second=entry({id:2,name:"Меч"});const drop=vi.fn();
  render(<DndRegister entries={[first,second]} kind="equipment" grouping="manual" expanded={new Set()} manual onToggle={vi.fn()} onDrop={drop} renderArticle={()=>null} />);
  const row=screen.getByRole("button",{name:"Меч"}).closest("tr")!;
  fireEvent.drop(row,{dataTransfer:{getData:()=>"1"}});
  expect(drop).toHaveBeenCalledWith([first,second],1,2);
});
it("плитка ДнД передаёт запись в раскрытие раздела без отдельного профиля",()=>{
  const open=vi.fn(), feat=entry({name:"Адепт",kind:"feat"});
  render(<MemoryRouter><SimpleKindTileGrid entries={[feat]} grouping="alpha" sectionId={2} searchActive={false} onToggleFavourite={vi.fn()} categoryField="category" kindLabel="Черта" onOpenEntry={open} /></MemoryRouter>);
  fireEvent.click(screen.getByText("Адепт"));expect(open).toHaveBeenCalledWith(feat);expect(screen.queryByRole("dialog")).toBeNull();
});
