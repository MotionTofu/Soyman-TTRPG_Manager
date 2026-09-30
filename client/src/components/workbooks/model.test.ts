import {describe,expect,it} from "vitest";
import {mergeWorkbookAnswers} from "./model";
describe('слияние тетрадей',()=>{
 it('объединяет разные поля и показывает конфликт одного поля без мутации источников',()=>{
  const base={sheet:{title:'Старая',distance:1}},mine={sheet:{title:'Моя',distance:1}},theirs={sheet:{title:'Чужая',distance:2}};
  const result=mergeWorkbookAnswers(base,mine,theirs);expect(result.answers).toEqual({sheet:{title:'Моя',distance:2}});expect(result.conflicts).toEqual([{sheet:'sheet',field:'title',mine:'Моя',theirs:'Чужая'}]);expect(base.sheet.title).toBe('Старая');
 });
 it('сохраняет удаление и перестановку карточек с постоянными идентификаторами',()=>{
  const base={sheet:{cards:[{_id:'1',a:'A'},{_id:'2',a:'B'}]}},mine={sheet:{cards:[{_id:'2',a:'B'},{_id:'1',a:'A'}]}};
  const result=mergeWorkbookAnswers(base,mine,{sheet:{...base.sheet,other:'В другом окне'}});expect(result.conflicts).toHaveLength(0);expect(result.answers.sheet.cards).toEqual(mine.sheet.cards);expect(result.answers.sheet.other).toBe('В другом окне');
 });
});
