// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { CampaignMilestones } from "./CampaignMilestones";
import { CampaignSecrets } from "./CampaignSecrets";

const state=vi.hoisted(()=>({data:undefined as unknown,error:null as string|null,reload:vi.fn()}));
vi.mock("../data/hooks",()=>({useResource:()=>state,useAction:()=>vi.fn(),write:{}}));
vi.mock("../hooks/useConfirm",()=>({useConfirm:()=>[null,vi.fn()]}));
vi.mock("./mentions/MentionText",()=>({MentionText:({text}:{text:string})=><span>{text}</span>}));
beforeEach(()=>{state.data=undefined;state.error=null;state.reload.mockClear();});
afterEach(cleanup);

describe.each([
  ["вехи",CampaignMilestones,"Название вехи",/новая веха/i],
  ["тайны",CampaignSecrets,"Название",/своя запись/i],
] as const)("загрузка: %s",(_name,Component,placeholder,button)=>{
  function view(){return <QueryClientProvider client={new QueryClient()}><MemoryRouter><Component campaignId={1} settingId={2}/></MemoryRouter></QueryClientProvider>;}
  it("не раскрывает создание из-за временно пустого кэша, открывает по действию",()=>{
    const shown=render(view());
    expect(screen.getByRole("status")).toBeTruthy();
    expect(screen.queryByPlaceholderText(placeholder)).toBeNull();
    state.data={own:[{id:8,title:"Найти Морвен",description:"След у Башни",content:"След у Башни",kind:"secret",campaign_id:1,state:{achieved:0,revealed:0}}],groups:[]};
    shown.rerender(view());
    expect(screen.getByText("Найти Морвен")).toBeTruthy();
    expect(screen.queryByPlaceholderText(placeholder)).toBeNull();
    fireEvent.click(screen.getByRole("button",{name:button}));
    expect(screen.getByPlaceholderText(placeholder)).toBeTruthy();
  });
  it("показывает отказ чтения и повтор вместо приглашения создать записи",()=>{
    state.error="Не удалось прочитать записи";
    render(view());
    expect(screen.getByText(state.error)).toBeTruthy();
    expect(screen.queryByPlaceholderText(placeholder)).toBeNull();
    fireEvent.click(screen.getByRole("button",{name:/повторить/i}));
    expect(state.reload).toHaveBeenCalledTimes(1);
  });
});
