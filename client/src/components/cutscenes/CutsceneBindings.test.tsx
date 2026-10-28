// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { CutsceneSummary } from "../../data/cutscenes";
const mock=vi.hoisted(()=>({role:'gm',mobile:false,error:null as string|null,rows:[] as CutsceneSummary[],reload:vi.fn()}));
vi.mock('../../api/currentUser',()=>({useCurrentUser:()=>({user:{role:mock.role}})}));
vi.mock('../../hooks/useIsMobile',()=>({useIsMobile:()=>mock.mobile}));
vi.mock('../../data/hooks',()=>({useResource:vi.fn(()=>({data:mock.rows,loading:false,error:mock.error,reload:mock.reload}))}));
vi.mock('../../data/cutsceneBindings',async original=>({...await original<typeof import('../../data/cutsceneBindings')>(),cutsceneBindings:{add:vi.fn(async()=>[]),move:vi.fn(async()=>[]),remove:vi.fn(async()=>{})}}));
vi.mock('./CutsceneCover',()=>({CutsceneCover:()=>null}));
vi.mock('./CutsceneLaunchActions',()=>({CutsceneLaunchActions:({id,context}:{id:number;context:{kind:string;sessionId?:number;campaignId?:number}})=><button data-context={JSON.stringify(context)}>Показать {id}</button>}));
vi.mock('./CutscenePicker',()=>({CutscenePicker:({mode,onAdd,onClose}:{mode:string;onAdd:(id:number)=>Promise<boolean>;onClose:()=>void})=><div role="dialog" aria-label="Выбор катсцены"><span>{mode}</span><button onClick={()=>void onAdd(5)}>Выбрать пятую</button><button onClick={onClose}>Закрыть</button></div>}));
import { CutsceneBindings } from "./CutsceneBindings";
import { cutsceneBindings } from "../../data/cutsceneBindings";
import { useResource } from "../../data/hooks";
const context={kind:'session' as const,sessionId:8,campaignId:3};
const renderPlan=(props:Partial<Parameters<typeof CutsceneBindings>[0]>={})=>render(<MemoryRouter><CutsceneBindings context={context} {...props}/></MemoryRouter>);
beforeEach(()=>{vi.clearAllMocks();mock.role='gm';mock.mobile=false;mock.error=null;mock.rows=[1,2].map(id=>({id,name:`Катсцена ${id}`,description:'',savedVersion:'v1',createdAt:'now',updatedAt:'now',archivedAt:null}));});
afterEach(cleanup);
describe('подборка и план',()=>{
  it('план передаёт контекст сессии в общий запуск',()=>{renderPlan();expect(screen.getByRole('button',{name:'Показать 1'}).getAttribute('data-context')).toBe(JSON.stringify(context));});
  it('подборка передаёт кампанию без sessionId и не предлагает порядок плана',()=>{
    const campaign={kind:'campaign' as const,campaignId:3};renderPlan({context:campaign});expect(screen.getByRole('button',{name:'Показать 1'}).getAttribute('data-context')).toBe(JSON.stringify(campaign));expect(screen.queryByRole('button',{name:/выше/})).toBeNull();
  });
  it('добавляет только в выбранный план',async()=>{renderPlan();fireEvent.click(screen.getByRole('button',{name:'Добавить в план'}));fireEvent.click(screen.getByRole('button',{name:'Выбрать пятую'}));await waitFor(()=>expect(cutsceneBindings.add).toHaveBeenCalledWith(context,5));});
  it('убирает ссылку и передвигает пункт по устойчивым ID',async()=>{
    renderPlan();fireEvent.click(screen.getByRole('button',{name:'Катсцена «Катсцена 2» выше'}));await waitFor(()=>expect(cutsceneBindings.move).toHaveBeenCalledWith(context,2,1));
    fireEvent.click(screen.getByRole('button',{name:'Убрать катсцену «Катсцена 1» из плана'}));await waitFor(()=>expect(cutsceneBindings.remove).toHaveBeenCalledWith(context,1));
  });
  it('панель быстрого запуска не редактирует план и ищет другую катсцену',()=>{
    renderPlan({mode:'launch'});expect(screen.queryByRole('button',{name:/из плана/})).toBeNull();expect(screen.queryByRole('button',{name:/выше/})).toBeNull();fireEvent.click(screen.getByRole('button',{name:'Другая катсцена'}));expect(screen.getByText('launch')).toBeTruthy();
  });
  it('не скрывает архивные ссылки из существующего плана',()=>{mock.rows[0]={...mock.rows[0],archivedAt:'now'};renderPlan();expect(screen.getByText('1. Катсцена 1')).toBeTruthy();expect(screen.getByText('В архиве')).toBeTruthy();expect(screen.getByRole('button',{name:'Показать 1'}).getAttribute('data-context')).toBe(JSON.stringify(context));});
  it('телефон оставляет ссылки на чтение без редактирования и управления',()=>{mock.mobile=true;renderPlan();expect(screen.getByRole('link',{name:'1. Катсцена 1'})).toBeTruthy();expect(screen.queryByRole('button')).toBeNull();});
  it('player-account не читает закрытый план',()=>{mock.role='player';renderPlan();expect(useResource).not.toHaveBeenCalled();});
  it('ошибка чтения оставляет сохранённые строки и обычный повтор',()=>{mock.error='offline';renderPlan();expect(screen.getByRole('link',{name:'1. Катсцена 1'})).toBeTruthy();fireEvent.click(screen.getByRole('button',{name:'Повторить'}));expect(mock.reload).toHaveBeenCalled();});
  it('пустой план в пульте показывает подборку кампании и запускает её в контексте сессии',()=>{
    const collection=mock.rows;vi.mocked(useResource).mockImplementation(((path:string|null)=>({data:path==='/campaigns/3/cutscenes'?collection:path===null?undefined:[],loading:false,error:null,reload:mock.reload})) as typeof useResource);
    renderPlan({mode:'launch'});expect(screen.getByText('Из подборки кампании')).toBeTruthy();expect(screen.getByText('В плане этой сессии катсцен нет.')).toBeTruthy();
    expect(screen.getByRole('button',{name:'Показать 2'}).getAttribute('data-context')).toBe(JSON.stringify(context));
  });
  it('пустой план при подготовке сессии не подставляет подборку',()=>{
    vi.mocked(useResource).mockImplementation(((path:string|null)=>({data:path==='/campaigns/3/cutscenes'?mock.rows:path===null?undefined:[],loading:false,error:null,reload:mock.reload})) as typeof useResource);
    renderPlan();expect(screen.queryByText('Из подборки кампании')).toBeNull();
  });
});
