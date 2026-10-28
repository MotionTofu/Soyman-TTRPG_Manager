// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createCutsceneDocument, createCutsceneStep } from "@shared/cutscenes/defaults";
import type { CutsceneOriginal } from "@shared/cutscenes/types";
vi.mock('../../data/cutscenes',()=>({cutscenes:{saveDraft:vi.fn()}}));
vi.mock('../../data/notices',()=>({showSaveError:vi.fn(()=>1),dismissNotice:vi.fn()}));
vi.mock('./CutsceneDraftFrame',()=>({CutsceneDraftFrame:()=> <div>Кадр</div>}));
vi.mock('./CutsceneMediaPicker',()=>({CutsceneMediaPicker:({onPick,onClose,title}:{onPick:(items:unknown[])=>void;onClose:()=>void;title:string})=><div role="dialog" aria-label={title}><button onClick={()=>{onPick([{ref:{kind:'image',id:'a'},name:'01_Road_to_Berez.png'},{ref:{kind:'image',id:'b'},name:'Ravenloft.jpg'}]);onClose();}}>Выбрать два файла</button></div>}));
vi.mock('../mentions/MentionTextarea',()=>({MentionTextarea:({id,value,onChange}:{id:string;value:string;onChange:(v:string)=>void})=><textarea id={id} value={value} onChange={event=>onChange(event.target.value)} />}));
vi.mock('./WorkshopComposition',()=>({WorkshopComposition:()=> <div>Композиция</div>}));
vi.mock('./WorkshopAudio',()=>({WorkshopAudio:()=> <div>Музыкальная команда</div>,WorkshopAudioSummary:()=> <p>Наследованный звук</p>}));
vi.mock('../../cutscenes/useWorkshopPreview',()=>({useWorkshopPreview:()=>({controller:previewMock,state:previewState})}));
const previewMock={configure:vi.fn(),leave:vi.fn(),stop:vi.fn(async()=>true),play:vi.fn(),repeatVisual:vi.fn(),external:vi.fn(),textPause:vi.fn()};
const previewState={phase:'idle',mode:null,external:false,error:null,foreign:null,playKey:0,textGeneration:0,textPaused:true,auditionLoop:false,visualPlayback:{elapsedMs:0,startedAt:null}};
vi.mock('./CutsceneLaunchActions',()=>({CutsceneLaunchActions:()=> <button>Показать игрокам</button>}));
vi.mock('./CutsceneTeleprompter',()=>({TeleprompterView:({narration}:{narration:{text:string|null}})=> <div>{narration.text||'Текста нет.'}</div>}));
import { cutscenes } from "../../data/cutscenes";
import { CutsceneWorkshopEditor } from "./CutsceneWorkshopEditor";
let sequence=1200;
const original=():CutsceneOriginal=>({id:sequence++,savedVersion:'v1',createdAt:'now',updatedAt:'now',archivedAt:null,document:createCutsceneDocument('Пролог')});
beforeEach(()=>{vi.useFakeTimers();vi.clearAllMocks();vi.mocked(cutscenes.saveDraft).mockImplementation(async(id,_base,document)=>({...original(),id,document,savedVersion:'v2'}));});
afterEach(()=>{cleanup();vi.clearAllTimers();vi.useRealTimers();});
describe('мастерская шагов',()=>{
  it('показывает пустой черновик и добавляет шаг с независимыми каналами',async()=>{
    render(<CutsceneWorkshopEditor original={original()} />);fireEvent.click(screen.getByRole('button',{name:'Добавить шаг'}));expect(screen.getByRole('button',{name:'Открыть шаг 1'})).toBeTruthy();
    await act(()=>vi.advanceTimersByTimeAsync(500));expect(vi.mocked(cutscenes.saveDraft).mock.calls[0][2].steps[0]).toMatchObject({image:{action:'keep'},audio:{action:'keep'},text:{action:'keep'}});
  });
  it('массовые картинки создают два шага',async()=>{
    render(<CutsceneWorkshopEditor original={original()} />);fireEvent.click(screen.getByRole('button',{name:'Шаги из изображений'}));fireEvent.click(screen.getByRole('button',{name:'Выбрать два файла'}));
    await act(()=>vi.advanceTimersByTimeAsync(500));const steps=vi.mocked(cutscenes.saveDraft).mock.calls[0][2].steps;expect(steps).toHaveLength(2);expect(steps.map(step=>step.image.action==='replace'&&step.image.composition.background?.id)).toEqual(['a','b']);expect(steps.map(step=>step.name)).toEqual(['Road to Berez','Ravenloft']);
    expect(screen.getByRole('button',{name:'Открыть шаг 1'}).textContent).toContain('1 · Road to Berez');
  });
  it('после перестановки пересчитывает наследование текста',()=>{
    const first=original(),row={...first,document:{...first.document,steps:[{...createCutsceneStep('first'),text:{action:'replace' as const,text:'Начало истории'}},createCutsceneStep('second')]}};
    render(<CutsceneWorkshopEditor original={row} />);fireEvent.click(screen.getByRole('button',{name:'Открыть шаг 2'}));fireEvent.click(screen.getByRole('button',{name:'Текст и заметки'}));expect(screen.getByText('Начало истории')).toBeTruthy();
    fireEvent.click(screen.getByRole('button',{name:'Шаг 2 выше'}));expect(screen.queryByText('Начало истории')).toBeNull();expect(screen.getByText('Текста нет.')).toBeTruthy();
  });
  it('форматированный текст и заметки попадают в единый автосейв',async()=>{
    const first=original(),row={...first,document:{...first.document,steps:[createCutsceneStep('one')]}};render(<CutsceneWorkshopEditor original={row} />);
    fireEvent.click(screen.getByRole('button',{name:'Текст и заметки'}));fireEvent.click(screen.getByRole('button',{name:'Своё'}));
    fireEvent.change(screen.getByRole('textbox',{name:'Редактирование · Только ведущему'}),{target:{value:'**Ночь**'}});fireEvent.change(screen.getByRole('textbox',{name:'Заметки к шагу · Только ведущему'}),{target:{value:'Пауза'}});
    await act(()=>vi.advanceTimersByTimeAsync(500));expect(vi.mocked(cutscenes.saveDraft).mock.calls[0][2].steps[0]).toMatchObject({text:{action:'replace',text:'**Ночь**'},notes:'Пауза'});
  });
  it('имя шага попадает в автосейв и в список шагов',async()=>{
    const first=original(),row={...first,document:{...first.document,steps:[createCutsceneStep('one')]}};render(<CutsceneWorkshopEditor original={row} />);
    expect((screen.getByRole('textbox',{name:'Имя шага'}) as HTMLInputElement).placeholder).toContain('«Шаг 1»');
    fireEvent.change(screen.getByRole('textbox',{name:'Имя шага'}),{target:{value:'Пролог'}});
    expect(screen.getByRole('button',{name:'Открыть шаг 1'}).textContent).toContain('1 · Пролог');
    await act(()=>vi.advanceTimersByTimeAsync(500));expect(vi.mocked(cutscenes.saveDraft).mock.calls[0][2].steps[0].name).toBe('Пролог');
  });
  it('смена действия, стирающая подготовленный текст, спрашивает подтверждение (КС9)',async()=>{
    const first=original(),row={...first,document:{...first.document,steps:[{...createCutsceneStep('one'),text:{action:'replace' as const,text:'Ночь'}}]}};render(<CutsceneWorkshopEditor original={row} />);
    fireEvent.click(screen.getByRole('button',{name:'Текст и заметки'}));fireEvent.click(screen.getByRole('button',{name:'Убрать'}));
    expect(screen.getByText('Текст ведущего этого шага будет стёрт.')).toBeTruthy();fireEvent.click(screen.getByRole('button',{name:'Отмена'}));
    await act(()=>vi.advanceTimersByTimeAsync(500));expect(cutscenes.saveDraft).not.toHaveBeenCalled();
    expect(screen.getByRole('button',{name:'Своё'}).getAttribute('aria-pressed')).toBe('true');
  });
  it('значки каналов называют состояние каждого канала шага',()=>{
    const first=original(),row={...first,document:{...first.document,steps:[{...createCutsceneStep('one'),text:{action:'clear' as const}}]}};render(<CutsceneWorkshopEditor original={row} />);
    expect(screen.getByRole('img',{name:'Кадр: как на прошлом шаге, Звук: как на прошлом шаге, Текст: убрано'})).toBeTruthy();
  });
});
