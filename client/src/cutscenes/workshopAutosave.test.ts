import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCutsceneDocument, createCutsceneStep } from "@shared/cutscenes/defaults";
import type { CutsceneDocument, CutsceneOriginal } from "@shared/cutscenes/types";
vi.mock('../data/cutscenes',()=>({cutscenes:{saveDraft:vi.fn()}}));
vi.mock('../data/notices',()=>({showSaveError:vi.fn(()=>1),dismissNotice:vi.fn()}));
import { dismissNotice, showSaveError } from "../data/notices";
import { WorkshopAutosave } from "./workshopAutosave";

const original=(document:CutsceneDocument=createCutsceneDocument('Город'),savedVersion='v1'):CutsceneOriginal=>({id:12,savedVersion,document,createdAt:'now',updatedAt:'now',archivedAt:null});
beforeEach(()=>{vi.useFakeTimers();vi.clearAllMocks();});afterEach(()=>{vi.clearAllTimers();vi.useRealTimers();});
describe('единое автосохранение мастерской',()=>{
  it('объединяет метаданные и шаги в один отложенный запрос',async()=>{
    const save=vi.fn(async (_id:number,_base:CutsceneDocument,draft:CutsceneDocument)=>original(draft,'v2')),manager=new WorkshopAutosave(original(),save);
    manager.edit(d=>({...d,name:'Новое'}));manager.edit(d=>({...d,steps:[createCutsceneStep('one')]}));expect(save).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(500);expect(save).toHaveBeenCalledTimes(1);expect(manager.snapshot()).toMatchObject({status:'saved',draft:{name:'Новое',steps:[{id:'one'}]},saved:{savedVersion:'v2'}});
  });
  it('не запускает второй запрос в полёте и не теряет более новый ввод',async()=>{
    let complete!:(value:CutsceneOriginal)=>void;
    const save=vi.fn((_id:number,_base:CutsceneDocument,draft:CutsceneDocument)=>Promise.resolve(original(draft,'v3'))).mockImplementationOnce(()=>new Promise(resolve=>{complete=resolve;}));
    const manager=new WorkshopAutosave(original(),save);manager.edit(d=>({...d,name:'Отправлено'}));const flight=manager.flush();
    manager.edit(d=>({...d,name:'Уже новее'}));await vi.advanceTimersByTimeAsync(500);expect(save).toHaveBeenCalledTimes(1);
    complete(original({...createCutsceneDocument('Отправлено')},'v2'));await flight;expect(manager.snapshot().draft.name).toBe('Уже новее');expect(manager.snapshot().saved.document.name).toBe('Отправлено');
    await vi.advanceTimersByTimeAsync(500);expect(save).toHaveBeenCalledTimes(2);expect(manager.snapshot().saved.document.name).toBe('Уже новее');
  });
  it('ошибка сохраняет последнюю успешную версию и не вызывает бесконечный повтор',async()=>{
    const save=vi.fn().mockRejectedValue(Error('offline')),manager=new WorkshopAutosave(original(),save);manager.edit(d=>({...d,description:'Не терять'}));await manager.flush();
    expect(manager.snapshot()).toMatchObject({status:'error',draft:{description:'Не терять'},saved:{savedVersion:'v1',document:{description:''}}});
    await vi.advanceTimersByTimeAsync(5000);expect(save).toHaveBeenCalledTimes(1);expect(showSaveError).toHaveBeenCalled();
  });
  it('повтор берёт актуальный черновик вместо старого снимка ошибки',async()=>{
    const save=vi.fn(async (_id:number,_base:CutsceneDocument,draft:CutsceneDocument)=>original(draft,'v2')).mockRejectedValueOnce(Error('offline'));
    const manager=new WorkshopAutosave(original(),save);manager.edit(d=>({...d,name:'Сначала'}));await manager.flush();manager.edit(d=>({...d,name:'Актуально'}));await manager.flush();
    expect(save.mock.calls[1][2].name).toBe('Актуально');expect(manager.snapshot().status).toBe('saved');
  });
  it('возврат к сохранённому документу снимает устаревшую ошибку',async()=>{
    const manager=new WorkshopAutosave(original(),vi.fn().mockRejectedValue(Error('offline')));manager.edit(d=>({...d,name:'Не записалось'}));await manager.flush();
    manager.edit(d=>({...d,name:'Город'}));await manager.flush();expect(manager.snapshot().status).toBe('saved');expect(dismissNotice).toHaveBeenCalledWith(1);
  });
  it('пустой черновик с названием сохраняется',async()=>{
    const save=vi.fn(async (_id:number,_base:CutsceneDocument,draft:CutsceneDocument)=>original(draft,'v2')),manager=new WorkshopAutosave(original(),save);
    manager.edit(d=>({...d,description:'Пока без шагов'}));await manager.flush();expect(save).toHaveBeenCalledTimes(1);expect(manager.snapshot().saved.document.steps).toEqual([]);
  });
  it('невалидное имя не подменяет сохранённую версию',async()=>{
    const save=vi.fn(),manager=new WorkshopAutosave(original(),save);manager.edit(d=>({...d,name:''}));await manager.flush();expect(save).not.toHaveBeenCalled();expect(manager.snapshot()).toMatchObject({status:'error',saved:{savedVersion:'v1'}});
  });
  it('внешняя правка обновляет свободное поле и не трогает локальную правку',()=>{
    const manager=new WorkshopAutosave(original(),vi.fn());manager.edit(d=>({...d,name:'Наше'}));manager.receive(original({...createCutsceneDocument('Чужое'),description:'Извне'},'v2'));
    expect(manager.snapshot().draft).toMatchObject({name:'Наше',description:'Извне'});
  });
  it('нетронутое активное поле принимает отложенное значение при уходе',()=>{
    const manager=new WorkshopAutosave(original(),vi.fn());manager.setFocus(['name']);manager.receive(original(createCutsceneDocument('Извне'),'v2'));
    expect(manager.snapshot().draft.name).toBe('Город');expect(manager.dirty()).toBe(false);manager.setFocus(null);expect(manager.snapshot().draft.name).toBe('Извне');
  });
  it('возврат к прежнему значению после внешней правки остаётся явным локальным вводом',async()=>{
    const save=vi.fn(async (_id:number,_base:CutsceneDocument,draft:CutsceneDocument)=>original(draft,'v3')),manager=new WorkshopAutosave(original(),save);
    manager.setFocus(['name']);manager.receive(original(createCutsceneDocument('Извне'),'v2'));manager.edit(d=>({...d,name:''}));manager.edit(d=>({...d,name:'Город'}));
    expect(manager.dirty()).toBe(true);await manager.flush();expect(save.mock.calls[0][1].name).toBe('Извне');expect(manager.snapshot().saved.document.name).toBe('Город');
    manager.setFocus(null);expect(manager.snapshot().draft.name).toBe('Город');
  });
  it('завершает сохранение после ухода подписчика со страницы',async()=>{
    const save=vi.fn(async (_id:number,_base:CutsceneDocument,draft:CutsceneDocument)=>original(draft,'v2')),manager=new WorkshopAutosave(original(),save),unsubscribe=manager.subscribe(vi.fn());
    manager.edit(d=>({...d,name:'После ухода'}));unsubscribe();await vi.advanceTimersByTimeAsync(500);expect(manager.snapshot().saved.document.name).toBe('После ухода');
  });
});
