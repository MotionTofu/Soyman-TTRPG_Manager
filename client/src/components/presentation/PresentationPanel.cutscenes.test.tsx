// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
const mock=vi.hoisted(()=>({cover:false}));
vi.mock('../../data/hooks',async original=>({...await original<typeof import('../../data/hooks')>(),useEntity:()=>({data:null}),useResource:(path:string|null)=>({data:path?.includes('cover')&&mock.cover?{background_url:'/cover.png',layers:[]}:path?.includes('show-state')?{shown:0,mode:'cover',scene_id:null,visible_layer_ids:[]}:null})}));
vi.mock('../cutscenes/CutsceneBindings',()=>({CutsceneBindings:({context,mode}:{context:{sessionId:number};mode:string})=><div>Катсцены сессии {context.sessionId} · {mode}</div>}));
vi.mock('./PresentationStage',()=>({PresentationStage:()=>null}));
vi.mock('./ScreenPreview',()=>({ScreenPreview:({children}:{children:ReactNode})=><div>{children}</div>}));
import { queryClient } from "../../data/queryClient";
import { PresentationPanel } from "./PresentationPanel";
beforeEach(()=>{mock.cover=false;queryClient.clear();});afterEach(cleanup);
const show=()=>render(<QueryClientProvider client={queryClient}><PresentationPanel sessionId={8} campaignId={3}/></QueryClientProvider>);
describe('катсцены внутри штатной панели показа',()=>{
  it('не скрывает панель при отсутствии сцен, карт и заглавного',()=>{show();expect(screen.getByText('Представление')).toBeTruthy();expect(screen.getByText('Катсцены сессии 8 · launch')).toBeTruthy();});
  it('сохраняет обычные кнопки заглавного рядом с катсценами',()=>{mock.cover=true;show();expect(screen.getByRole('button',{name:'Показать заглавное'})).toBeTruthy();expect(screen.getByText('Катсцены сессии 8 · launch')).toBeTruthy();});
});
