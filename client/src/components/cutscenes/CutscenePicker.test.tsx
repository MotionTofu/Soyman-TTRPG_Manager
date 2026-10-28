// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
const mock=vi.hoisted(()=>({read:vi.fn()}));
vi.mock('../../data/hooks',()=>({useResource:mock.read}));
vi.mock('./CutsceneCover',()=>({CutsceneCover:()=>null}));
vi.mock('./CutsceneLaunchActions',()=>({CutsceneLaunchActions:({context,onStarted}:{context:unknown;onStarted:()=>void})=><button data-context={JSON.stringify(context)} onClick={onStarted}>Открыть готовность</button>}));
import { CutscenePicker } from "./CutscenePicker";
const context={kind:'session' as const,sessionId:8,campaignId:3};
beforeEach(()=>{vi.clearAllMocks();mock.read.mockReturnValue({data:[{id:1,name:'Вступление',description:'Ворота',savedVersion:'v1'},{id:2,name:'Финал',description:'',savedVersion:'v2'}],loading:false,error:null,reload:vi.fn()});});
afterEach(cleanup);
describe('выбор общего оригинала',()=>{
  it('ищет по общему каталогу, не ограничивая подборкой кампании',()=>{
    render(<MemoryRouter><CutscenePicker context={context} mode="add" onClose={vi.fn()}/></MemoryRouter>);
    fireEvent.change(screen.getByRole('searchbox',{name:'Поиск катсцен'}),{target:{value:'Ворота'}});
    const paths=mock.read.mock.calls.map(call=>call[0]);expect(paths.at(-1)).toContain(encodeURIComponent('Ворота'));expect(paths.every(path=>!path.includes('campaignId'))).toBe(true);
  });
  it('повторный оригинал нельзя добавить в план',()=>{
    render(<MemoryRouter><CutscenePicker context={context} mode="add" existingIds={[1]} onClose={vi.fn()}/></MemoryRouter>);expect(screen.getByRole('button',{name:'Катсцена «Вступление» уже добавлена'}).hasAttribute('disabled')).toBe(true);
  });
  it('успех добавления закрывает выбор, отказ оставляет его доступным',async()=>{
    const onAdd=vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true),onClose=vi.fn();
    render(<MemoryRouter><CutscenePicker context={context} mode="add" onAdd={onAdd} onClose={onClose}/></MemoryRouter>);
    fireEvent.click(screen.getByRole('button',{name:'Добавить катсцену «Финал»'}));await waitFor(()=>expect(onAdd).toHaveBeenCalledWith(2));expect(onClose).not.toHaveBeenCalled();
    await waitFor(()=>expect(screen.getByRole('button',{name:'Добавить катсцену «Финал»'}).hasAttribute('disabled')).toBe(false));
    fireEvent.click(screen.getByRole('button',{name:'Добавить катсцену «Финал»'}));await waitFor(()=>expect(onClose).toHaveBeenCalledTimes(1));
  });
  it('поиск для пульта запускает в том же контексте без добавления в план',()=>{
    const onAdd=vi.fn(),onClose=vi.fn();render(<MemoryRouter><CutscenePicker context={context} mode="launch" onAdd={onAdd} onClose={onClose}/></MemoryRouter>);
    expect(screen.getAllByRole('button',{name:'Открыть готовность'})[0].getAttribute('data-context')).toBe(JSON.stringify(context));fireEvent.click(screen.getAllByRole('button',{name:'Открыть готовность'})[0]);expect(onClose).toHaveBeenCalled();expect(onAdd).not.toHaveBeenCalled();
  });
});
