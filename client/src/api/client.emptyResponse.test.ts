// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock('../dataSync',()=>({isBusyEditing:()=>false,notifyDataChanged:vi.fn()}));
vi.mock('../data/journal',()=>({reportRequest:vi.fn(),setJournalSender:vi.fn()}));
vi.mock('../data/queryClient',()=>({queryClient:{invalidateQueries:vi.fn()}}));
import { api } from "./client";
import { notifyDataChanged } from "../dataSync";
const json=vi.fn(),text=vi.fn(),fetchMock=vi.fn();
beforeEach(()=>{vi.clearAllMocks();vi.stubGlobal('fetch',fetchMock);fetchMock.mockResolvedValue({ok:true,status:204,json,text});});
afterEach(()=>vi.unstubAllGlobals());
describe('успешный ответ без тела',()=>{
  it('DELETE 204 не пытается прочитать JSON и не объявляет общую запись при broadcast:false',async()=>{
    await expect(api.del('/campaigns/3/cutscenes/1',{broadcast:false})).resolves.toBeUndefined();expect(json).not.toHaveBeenCalled();expect(text).not.toHaveBeenCalled();expect(notifyDataChanged).not.toHaveBeenCalled();
  });
  it('текстовый запрос 204 возвращает пустую строку',async()=>{await expect(api.getText('/empty')).resolves.toBe('');expect(json).not.toHaveBeenCalled();});
  it('обычный успешный JSON продолжает читаться',async()=>{fetchMock.mockResolvedValue({ok:true,status:200,json:vi.fn(async()=>({ok:true}))});await expect(api.put('/rows/1',{}, {broadcast:false})).resolves.toEqual({ok:true});});
  it('неуспешный ответ сохраняет статус и текст ошибки',async()=>{fetchMock.mockResolvedValue({ok:false,status:409,text:vi.fn(async()=>JSON.stringify({error:'Контекст изменён'}))});await expect(api.del('/rows/1',{broadcast:false})).rejects.toMatchObject({status:409,message:'Контекст изменён'});});
});
