import { describe, expect, it } from "vitest";
import { createCutsceneDocument, createCutsceneStep, createCutsceneAudioCommand } from "@shared/cutscenes/defaults";
import { resolveCutsceneStep } from "@shared/cutscenes/resolve";
import { duplicateWorkshopStep, emptyComposition, imageWorkshopStep, mergeWorkshopDraft, moveWorkshopStep } from "./workshopDraft";

const base = () => ({ ...createCutsceneDocument('Город'),steps:[{ ...createCutsceneStep('one'),text:{ action:'replace' as const,text:'Начало' } },createCutsceneStep('two')] });
describe('слияние мастерской по устойчивым ID',()=>{
  it('сохраняет локальное имя и принимает чужое описание',()=>{
    const b=base();expect(mergeWorkshopDraft(b,{ ...b,name:'Мой город' },{ ...b,name:'Чужое имя',description:'Утро' })).toMatchObject({name:'Мой город',description:'Утро'});
  });
  it('откладывает значение активного поля, обновляя остальное',()=>{
    const b=base();expect(mergeWorkshopDraft(b,b,{ ...b,name:'Новое',description:'Извне' },['name'])).toMatchObject({name:'Город',description:'Извне'});
  });
  it('не считает нетронутое активное поле локальной правкой при сохранении',()=>{
    const b=base();expect(mergeWorkshopDraft(b,{ ...b,description:'Наше' },{ ...b,name:'Чужое' }).name).toBe('Чужое');
  });
  it('перестановка не привязывает чужую правку к индексу',()=>{
    const b=base(),local=moveWorkshopStep(b,'two','one'),remote={...b,steps:b.steps.map(step=>step.id==='one'?{...step,notes:'Извне'}:step)};
    const result=mergeWorkshopDraft(b,local,remote);expect(result.steps.map(step=>step.id)).toEqual(['two','one']);expect(result.steps[1].notes).toBe('Извне');
  });
  it('при локальной правке текста принимает новые заметки этого же шага',()=>{
    const b=base(),local={...b,steps:[{...b.steps[0],text:{action:'replace' as const,text:'Наш текст'}},b.steps[1]]},remote={...b,steps:[{...b.steps[0],notes:'Новая заметка'},b.steps[1]]};
    expect(mergeWorkshopDraft(b,local,remote).steps[0]).toMatchObject({text:{text:'Наш текст'},notes:'Новая заметка'});
  });
  it('не смешивает несовместимые варианты команды',()=>{
    const b=base(),local={...b,steps:[{...b.steps[0],text:{action:'clear' as const}},b.steps[1]]};
    expect(mergeWorkshopDraft(b,local,{...b,steps:[{...b.steps[0],text:{action:'replace' as const,text:'Чужой текст'}},b.steps[1]]}).steps[0].text).toEqual({action:'clear'});
  });
  it('сохраняет локальное удаление и добавленный извне шаг',()=>{
    const b=base(),local={...b,steps:[b.steps[1]]},remote={...b,steps:[...b.steps,createCutsceneStep('three')]};
    expect(mergeWorkshopDraft(b,local,remote).steps.map(step=>step.id)).toEqual(['two','three']);
  });
  it('принимает чужое удаление нетронутого шага, сохраняя редактируемый',()=>{
    const b=base(),remote={...b,steps:[]};expect(mergeWorkshopDraft(b,b,remote).steps).toEqual([]);
    const local={...b,steps:[{...b.steps[0],notes:'Под руками'},b.steps[1]]};expect(mergeWorkshopDraft(b,local,remote).steps.map(step=>step.id)).toEqual(['one']);
  });
  it('дублирование даёт новые ID шага, слоя и команды',()=>{
    const first=imageWorkshopStep({kind:'image',id:'image'});
    const step={...first,image:{action:'replace' as const,transition:{kind:'fade' as const,durationMs:500},composition:{...emptyComposition(),layers:[{id:'layer',name:'Свет',image:{kind:'image' as const,id:'image'},visible:true,position:0,x_pct:0,y_pct:0,w_pct:50,h_pct:50}]}},audio:{action:'replace' as const,command:createCutsceneAudioCommand('command',{kind:'audio',id:'audio'})}};
    const copy=duplicateWorkshopStep(step);expect(copy.id).not.toBe(step.id);expect(copy.audio.action==='replace'&&copy.audio.command.id).not.toBe('command');
    expect(copy.image.action==='replace'&&copy.image.composition.layers[0].id).not.toBe('layer');
    expect(copy.image.action==='replace'&&copy.image.composition.layers[0].image).toEqual({kind:'image',id:'image'});
  });
  it('новый визуальный шаг использует согласованный переход и независимые каналы',()=>{
    const step=imageWorkshopStep({kind:'image',id:'image'});expect(step).toMatchObject({image:{transition:{kind:'fade',durationMs:500}},audio:{action:'keep'},text:{action:'keep'},notes:''});
  });
  it('перестановка меняет наследование тем же резолвером',()=>{
    const b=base();expect(resolveCutsceneStep(b,'two')?.text.text).toBe('Начало');expect(resolveCutsceneStep(moveWorkshopStep(b,'two','one'),'two')?.text.text).toBeNull();
  });
  it('порядок и геометрия слоёв сливаются по ID',()=>{
    const layer=(id:string)=>({id,name:id,image:{kind:'image' as const,id},visible:true,position:0,x_pct:0,y_pct:0,w_pct:50,h_pct:50});
    const b={...emptyComposition(),layers:[layer('a'),{...layer('b'),position:1}]};
    const local={...b,layers:[{...b.layers[0],x_pct:20},b.layers[1]]},remote={...b,layers:[b.layers[0],{...b.layers[1],name:'Другое имя'}]};
    expect(mergeWorkshopDraft(b,local,remote).layers).toMatchObject([{x_pct:20},{name:'Другое имя'}]);
  });
});
