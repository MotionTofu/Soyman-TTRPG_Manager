import { describe, expect, it } from "vitest";
import { createCutsceneDocument, createCutsceneStep } from "@shared/cutscenes/defaults";
import { resolveCutsceneStep } from "@shared/cutscenes/resolve";
import type { CutsceneRunState } from "@shared/cutscenes/runApi";
import { readRehearsalFrame, rememberRehearsalFrame } from "./rehearsalFrames";
const composition={background:null,layers:[],title:"Титр",title_secs:3,fade_ms:600};
function fixture(id:string){const document={...createCutsceneDocument("Приватная репетиция"),steps:[
  {...createCutsceneStep("a"),notes:"Приватная заметка",text:{action:"replace" as const,text:"Приватный текст"},image:{action:"replace" as const,composition,transition:{kind:"black" as const,durationMs:1200}}},createCutsceneStep("b"),
  {...createCutsceneStep("c"),image:{action:"clear" as const,transition:{kind:"fade" as const,durationMs:500}}},
]};return {document,run:{revision:1,snapshot:{runId:id,version:{document},returnState:{presentation:null}}} as unknown as CutsceneRunState};}
const data={background_path:null,background_url:null,title:"Титр",title_secs:3,fade_ms:600,transition:"cut",transition_ms:0,layers:[]};
describe("локальный адаптер полного прогона",()=>{
  it("показывает только подготовленную композицию с тем же переходом",()=>{
    const {document,run}=fixture("local-1"),step=resolveCutsceneStep(document,"a")!;expect(readRehearsalFrame(run,step)).toBeNull();rememberRehearsalFrame(run,step,data);
    expect(readRehearsalFrame(run,step)).toMatchObject({transition:{kind:"black",durationMs:1200},content:{kind:"composition",data}});
    const frame=JSON.stringify(readRehearsalFrame(run,step));expect(frame).not.toContain("Приватн");expect(frame).not.toContain("audio");
  });
  it("унаследованный кадр не переигрывает титр или переход",()=>{
    const {document,run}=fixture("local-2");rememberRehearsalFrame(run,resolveCutsceneStep(document,"a")!,data);
    expect(readRehearsalFrame(run,resolveCutsceneStep(document,"a")!)?.playKey).toBe(readRehearsalFrame(run,resolveCutsceneStep(document,"b")!)?.playKey);
  });
  it("чёрный шаг использует собственный переход без загрузки композиции",()=>{
    const {document,run}=fixture("local-3");expect(readRehearsalFrame(run,resolveCutsceneStep(document,"c")!)).toMatchObject({transition:{kind:"fade",durationMs:500},content:{kind:"black"}});
  });
  it("подготовка следующего шага не выталкивает ещё показанный кадр",()=>{
    const {document,run}=fixture("local-4"),a=resolveCutsceneStep(document,"a")!,b={...a,image:{...a.image,sourceStepId:"new-source"}};
    rememberRehearsalFrame(run,a,data);rememberRehearsalFrame(run,b,{...data,title:"Следующий"});expect(readRehearsalFrame(run,a)?.content).toMatchObject({data:{title:"Титр"}});
  });
});
