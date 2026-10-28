import type { CutsceneLaunchContext } from "@shared/cutscenes/types";
import type { CutsceneSummary } from "./cutscenes";
import { dataKeys } from "./entities";
import { queryClient } from "./queryClient";
import { readOnce, afterWriteAnywhere } from "./imperative";
import { write } from "./hooks";

export type CutsceneBindingContext = Exclude<CutsceneLaunchContext, { kind: "library" }>;
export const cutsceneBindingsPath = (context: CutsceneBindingContext) => context.kind === "campaign"
  ? `/campaigns/${context.campaignId}/cutscenes` : `/sessions/${context.sessionId}/cutscenes`;

/** A move targets a stable neighbour, so refreshed names/additions never change its meaning. */
export function moveCutsceneBinding<T extends { id: number }>(rows: readonly T[], id: number, targetId: number): T[] {
  const from=rows.findIndex(row=>row.id===id), to=rows.findIndex(row=>row.id===targetId);
  if(from<0||to<0||from===to)return [...rows];
  const next=[...rows], [item]=next.splice(from,1);next.splice(to,0,item);return next;
}
const queues=new Map<string,Promise<unknown>>();
function serial<T>(path: string, apply:()=>Promise<T>): Promise<T> {
  const next=(queues.get(path)??Promise.resolve()).catch(()=>{}).then(apply);queues.set(path,next);
  void next.finally(()=>{if(queues.get(path)===next)queues.delete(path);}).catch(()=>{});return next;
}
async function publish(path: string, rows: CutsceneSummary[], changed: boolean): Promise<CutsceneSummary[]> {
  const queryKey=dataKeys.resource(path);
  await queryClient.cancelQueries({queryKey,exact:true});queryClient.setQueryData(queryKey,rows);
  if(changed)afterWriteAnywhere([{path}]);return rows;
}
export const cutsceneBindings={
  add(context: CutsceneBindingContext, id: number): Promise<CutsceneSummary[]> {
    const path=cutsceneBindingsPath(context);return serial(path,async()=>{
      const current=await readOnce<CutsceneSummary[]>(path);
      if(current.some(row=>row.id===id))return publish(path,current,false);
      const rows=await write.put<CutsceneSummary[]>(path,{cutsceneIds:[...current.map(row=>row.id),id]});
      return publish(path,rows,true);
    });
  },
  move(context: CutsceneBindingContext, id: number, targetId: number): Promise<CutsceneSummary[]> {
    const path=cutsceneBindingsPath(context);return serial(path,async()=>{
      const current=await readOnce<CutsceneSummary[]>(path),next=moveCutsceneBinding(current,id,targetId);
      if(current.every((row,i)=>row.id===next[i]?.id))return publish(path,current,false);
      return publish(path,await write.put<CutsceneSummary[]>(path,{cutsceneIds:next.map(row=>row.id)}),true);
    });
  },
  remove(context: CutsceneBindingContext, id: number): Promise<void> {
    const path=cutsceneBindingsPath(context);return serial(path,async()=>{
      await write.del(`${path}/${id}`);
      const queryKey=dataKeys.resource(path);await queryClient.cancelQueries({queryKey,exact:true});
      queryClient.setQueryData<CutsceneSummary[]>(queryKey,rows=>rows?.filter(row=>row.id!==id));
      afterWriteAnywhere([{path}]);
    });
  },
};
