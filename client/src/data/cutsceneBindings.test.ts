import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CutsceneSummary } from "./cutscenes";
vi.mock('./hooks',()=>({write:{put:vi.fn(),del:vi.fn()}}));
vi.mock('./imperative',()=>({readOnce:vi.fn(),afterWriteAnywhere:vi.fn()}));
import { write } from "./hooks";
import { readOnce, afterWriteAnywhere } from "./imperative";
import { queryClient } from "./queryClient";
import { dataKeys, matchesAffect } from "./entities";
import { cutsceneBindings, cutsceneBindingsPath, moveCutsceneBinding } from "./cutsceneBindings";
const campaign={kind:'campaign' as const,campaignId:3},session={kind:'session' as const,sessionId:8,campaignId:3};
const row=(id:number):CutsceneSummary=>({id,name:`Катсцена ${id}`,description:'',savedVersion:'v1',createdAt:'now',updatedAt:'now',archivedAt:null});
beforeEach(()=>{vi.resetAllMocks();queryClient.clear();vi.mocked(readOnce).mockResolvedValue([row(1),row(2)]);vi.mocked(write.put).mockImplementation(async(_path,input)=>((input as {cutsceneIds:number[]}).cutsceneIds.map(row)) as never);});
describe('подборки и планы катсцен',()=>{
  it('пути кампании и сессии независимы',()=>{expect(cutsceneBindingsPath(campaign)).toBe('/campaigns/3/cutscenes');expect(cutsceneBindingsPath(session)).toBe('/sessions/8/cutscenes');});
  it('добавляет к свежему списку, не заменяя пришедшие из другого окна пункты',async()=>{
    await cutsceneBindings.add(session,3);expect(write.put).toHaveBeenCalledWith('/sessions/8/cutscenes',{cutsceneIds:[1,2,3]});expect(afterWriteAnywhere).toHaveBeenCalledWith([{path:'/sessions/8/cutscenes'}]);
    expect(write.put).not.toHaveBeenCalledWith('/campaigns/3/cutscenes',expect.anything());
  });
  it('повторное добавление не пишет дубликат и обновляет локальную сводку',async()=>{
    await cutsceneBindings.add(session,2);expect(write.put).not.toHaveBeenCalled();expect(queryClient.getQueryData(dataKeys.resource('/sessions/8/cutscenes'))).toEqual([row(1),row(2)]);
  });
  it('двигает относительно устойчивого соседа, сохраняя сторонние пункты',async()=>{
    vi.mocked(readOnce).mockResolvedValue([row(4),row(1),row(2),row(3)]);await cutsceneBindings.move(session,3,1);expect(write.put).toHaveBeenCalledWith('/sessions/8/cutscenes',{cutsceneIds:[4,3,1,2]});
  });
  it('исчезнувший сосед не удаляет пункт и не вызывает запись',async()=>{await cutsceneBindings.move(session,2,3);expect(write.put).not.toHaveBeenCalled();});
  it('очередь продолжает работу после отказа предыдущей записи',async()=>{
    vi.mocked(write.put).mockRejectedValueOnce(Error('offline'));const a=cutsceneBindings.add(session,3).catch(()=>null),b=cutsceneBindings.add(session,4);await Promise.all([a,b]);
    expect(vi.mocked(write.put).mock.calls.map(call=>call[1])).toEqual([{cutsceneIds:[1,2,3]},{cutsceneIds:[1,2,4]}]);
  });
  it('удаляет только ссылку, не оригинал или привязки другого контекста',async()=>{
    queryClient.setQueryData(dataKeys.resource('/sessions/8/cutscenes'),[row(1),row(2)]);await cutsceneBindings.remove(session,1);
    expect(write.del).toHaveBeenCalledExactlyOnceWith('/sessions/8/cutscenes/1');expect(queryClient.getQueryData(dataKeys.resource('/sessions/8/cutscenes'))).toEqual([row(2)]);
  });
  it('отказ записи сохраняет успешный список и не рассылает изменение',async()=>{
    queryClient.setQueryData(dataKeys.resource('/campaigns/3/cutscenes'),[row(1)]);vi.mocked(write.put).mockRejectedValueOnce(Error('offline'));
    await expect(cutsceneBindings.add(campaign,3)).rejects.toThrow('offline');expect(queryClient.getQueryData(dataKeys.resource('/campaigns/3/cutscenes'))).toEqual([row(1)]);expect(afterWriteAnywhere).not.toHaveBeenCalled();
  });
  it('перестановка вверх и вниз не создаёт повторов',()=>{const rows=[row(1),row(2),row(3)];expect(moveCutsceneBinding(rows,1,3).map(r=>r.id)).toEqual([2,3,1]);expect(moveCutsceneBinding(rows,3,1).map(r=>r.id)).toEqual([3,1,2]);});
  it('поздний GET не подменяет подтверждённую запись',async()=>{
    let complete!:(rows:CutsceneSummary[])=>void;const queryKey=dataKeys.resource('/sessions/8/cutscenes');
    const pending=queryClient.fetchQuery({queryKey,queryFn:()=>new Promise<CutsceneSummary[]>(resolve=>{complete=resolve;})}).catch(()=>null);
    await cutsceneBindings.add(session,3);complete([row(1)]);await pending;expect(queryClient.getQueryData(queryKey)).toEqual([row(1),row(2),row(3)]);
  });
  it('изменение подборки обновляет только каталог с фильтром этой кампании',()=>{
    const affect={path:'/campaigns/3/cutscenes'};expect(matchesAffect(dataKeys.resource('/cutscenes?archive=active&campaignId=3'),affect)).toBe(true);
    for(const path of ['/cutscenes?campaignId=4','/cutscenes?archive=all','/cutscenes/1','/sessions/8/cutscenes','/campaigns/3'])expect(matchesAffect(dataKeys.resource(path),affect)).toBe(false);
  });
});
