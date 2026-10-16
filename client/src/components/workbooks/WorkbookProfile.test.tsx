// @vitest-environment jsdom
import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import {cleanup,fireEvent,render,screen,waitFor} from "@testing-library/react";
import {MemoryRouter} from "react-router-dom";
import {WorkbookProfile} from "./WorkbookProfile";
import {WorkbookContext,type WorkbookInstance} from "./model";
const mocks=vi.hoisted(()=>({put:vi.fn(),read:vi.fn(),data:{id:5,name:'Мир',passport:{promise:'Обещание',tone:'Старый тон'}},sync:vi.fn()}));
vi.mock('../../data/hooks',()=>({useResource:()=>({data:mocks.data,error:null}),useAction:()=>async(action:()=>Promise<unknown>)=>action(),write:{put:mocks.put}}));
vi.mock('../../data/imperative',()=>({readOnce:mocks.read}));
vi.mock('../../mentions',()=>({syncMentionLinks:mocks.sync}));
vi.mock('../PaperFieldsCard',()=>({PaperFieldsCard:({values,onSave}:{values:Record<string,string>;onSave:(value:Record<string,string>)=>Promise<void>})=><div>{values.promise}<button onClick={()=>void onSave({...values,promise:'Новое обещание'}).catch(()=>{})}>Править паспорт</button></div>}));
vi.mock('../campaign/CampaignPassport',()=>({CampaignPassport:()=>null}));
vi.mock('../adventure/AdventureDossier',()=>({AdventureHead:()=>null,AdventureParticipants:()=>null,PassportCard:()=>null}));
vi.mock('./WorkbookCampaignViews',()=>({CampaignEntitiesView:({view}:{view:string})=><div>вид {view}</div>,CampaignHeroesView:()=>null,CampaignKnowledgeView:()=>null,CampaignSessionReviewView:()=>null,GroupGroundsView:()=>null,WorldMomentView:()=>null}));
vi.mock('../setting/SettingWorldTab',()=>({SettingWorldTab:({settingId,categories}:{settingId:number;categories:string[]})=><div>{settingId}:{categories.join(',')}</div>}));
beforeEach(()=>{vi.clearAllMocks();mocks.put.mockResolvedValue({});mocks.sync.mockResolvedValue({});mocks.read.mockResolvedValue({...mocks.data,passport:{promise:'Обещание',tone:'Новый тон',signature:['Черта']}});});
afterEach(cleanup);
const mount=(entity:string,projectType:string|null='setting')=>render(<MemoryRouter><WorkbookContext.Provider value={{document:{project_type:projectType,project_id:5} as WorkbookInstance,answers:{},onSheet:vi.fn()}}><WorkbookProfile field={{key:'profile',label:'Паспорт',type:'profile',entity}}/></WorkbookContext.Provider></MemoryRouter>);
describe('общие данные в тетради',()=>{
 it('меняет паспорт сеттинга, сохраняя другие свежие поля без копии в ответах',async()=>{
  mount('passport');expect(screen.getByText('Обещание')).toBeTruthy();fireEvent.click(screen.getByRole('button',{name:'Править паспорт'}));
  await waitFor(()=>expect(mocks.put).toHaveBeenCalledWith('/settings/5',{passport:{promise:'Новое обещание',tone:'Новый тон',signature:['Черта']}}));
  expect(mocks.put.mock.calls.every(([path])=>!path.includes('workbooks/instances'))).toBe(true);
 });
 it('открывает нужный вид записей мира и объясняет отсутствие проекта',()=>{
  const ui=mount('norm');expect(screen.getByText('5:norm')).toBeTruthy();ui.unmount();
  mount('passport',null);expect(screen.getByText(/Свяжите тетрадь с проектом/)).toBeTruthy();
 });
 it('виды тетради кампании открываются только в тетради кампании',()=>{
  const ui=mount('places','campaign');expect(screen.getByText('вид places')).toBeTruthy();ui.unmount();
  mount('sides','setting');expect(screen.getByText('Этот раздел — в тетради кампании.')).toBeTruthy();
 });
 it('показывает конфликт общего поля вместо перезаписи чужой правки',async()=>{
  mocks.read.mockResolvedValue({...mocks.data,passport:{promise:'Из другого окна'}});
  mount('passport');fireEvent.click(screen.getByRole('button',{name:'Править паспорт'}));
  expect(await screen.findByRole('alert')).toBeTruthy();expect(mocks.put).not.toHaveBeenCalled();
 });
});
