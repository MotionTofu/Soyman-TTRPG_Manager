import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock('./hooks',()=>({write:{post:vi.fn()}}));
vi.mock('./imperative',()=>({readOnce:vi.fn(),afterWriteAnywhere:vi.fn()}));
import { write } from "./hooks";
import { afterWriteAnywhere, readOnce } from "./imperative";
import { cutsceneMedia } from "./cutsceneMedia";
beforeEach(()=>vi.clearAllMocks());
describe('медиа мастерской',()=>{
  it('импорт из галереи использует ID и отдельный срок жизни материала',async()=>{
    vi.mocked(write.post).mockResolvedValue({ref:{kind:'image',id:'independent'}});await cutsceneMedia.importMedia(12,'image',{kind:'gallery',id:4});
    expect(write.post).toHaveBeenCalledWith('/cutscenes/12/media/import',{kind:'image',source:{kind:'gallery',id:4}},{timeoutMs:120000});expect(afterWriteAnywhere).toHaveBeenCalledWith([{path:'/cutscenes/12/media'}]);
  });
  it('загрузка передаёт файл, не сохраняя путь компьютера в документе',async()=>{
    await cutsceneMedia.upload(12,'audio',new File(['audio'],'track.wav',{type:'audio/wav'}));const [path,form]=vi.mocked(write.post).mock.calls[0];
    expect(path).toBe('/cutscenes/12/media/audio/upload');expect((form as FormData).get('file')).toBeTruthy();
  });
  it('временный доступ читается без объявления записи',async()=>{
    await cutsceneMedia.access(12,{kind:'image',id:'media'});expect(readOnce).toHaveBeenCalledWith('/cutscenes/12/media/media/access');expect(afterWriteAnywhere).not.toHaveBeenCalled();
  });
});
