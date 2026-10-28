// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCutsceneDocument, createCutsceneStep } from "@shared/cutscenes/defaults";
import { resolveCutsceneStep } from "@shared/cutscenes/resolve";
import type { CutscenePlaybackState } from "../../cutscenes/ports";
import type { CutscenePlaybackController } from "../../cutscenes/controller";
import { CutsceneReadiness } from "./CutsceneReadiness";

vi.mock("./CutsceneDraftFrame", () => ({ CutsceneDraftFrame: () => <div>Первое изображение</div> }));
vi.mock("../presentation/screens", () => ({ getScreens: vi.fn(async () => [
  { id: "main", label: "Монитор Мастера", primary: true }, { id: "table", label: "Стол игроков", primary: false },
]), loadLastScreenId: () => "table" }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
function fixture() {
  const document = { ...createCutsceneDocument("Вступление"), steps: [{ ...createCutsceneStep("first"), text: { action: "replace" as const, text: "**Читайте после начала**" }, notes: "Пауза у ворот" }] };
  const state = { phase: "ready", busy: false, error: null, issues: [], run: null, original: { id: 13, document }, preview: resolveCutsceneStep(document,"first") } as unknown as CutscenePlaybackState;
  const controller = { start: vi.fn(async () => true), select: vi.fn(), retry: vi.fn() };
  return { state, controller, props: { state, controller: controller as unknown as CutscenePlaybackController, mode: "live" as const, context: { kind: "library" as const }, onClose: vi.fn() } };
}
describe("готовность последней сохранённой версии", () => {
  it("сразу возвращает запомненный монитор при уже выданном разрешении", async () => {
    vi.stubGlobal("navigator", { permissions: { query: vi.fn(async () => ({ state: "granted" })) } });
    const f=fixture(); render(<CutsceneReadiness {...f.props} />);
    await waitFor(()=>expect((screen.getByRole("combobox") as HTMLSelectElement).value).toBe("table"));
    expect(f.controller.start).not.toHaveBeenCalled();
  });
  it("показывает кадр, форматированный текст, заметки и настройки до отдельного начала", async () => {
    const f=fixture(); render(<CutsceneReadiness {...f.props} />);
    expect(screen.getByText("Первое изображение")).toBeTruthy(); expect(screen.getByText("Читайте после начала").closest("strong")).toBeTruthy();
    expect(screen.getByText("Пауза у ворот")).toBeTruthy(); expect(screen.getByText("Весь звук приложения")).toBeTruthy();
    fireEvent.click(screen.getByRole("button",{name:"Выбрать монитор"}));
    await waitFor(()=>expect((screen.getByRole("combobox") as HTMLSelectElement).value).toBe("table")); expect(f.controller.start).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button",{name:"Начать"})); expect(f.controller.start).toHaveBeenCalledWith({mode:"live",context:{kind:"library"},screen:expect.objectContaining({id:"table"})});
  });
  it("пустой документ и отсутствующий материал запрещают начало и называют шаг", () => {
    const f=fixture(); render(<CutsceneReadiness {...f.props} state={{...f.state,issues:[{code:"media.missing",path:"steps.0.image",stepId:"first",message:"Материал не готов"}]}} />);
    expect(screen.getByText("1 · Читайте после начала: Материал не готов")).toBeTruthy(); expect(screen.getByRole("button",{name:"Начать"}).hasAttribute("disabled")).toBe(true);
    fireEvent.click(screen.getByRole("button",{name:"Проверить снова"})); expect(f.controller.select).toHaveBeenCalledWith(13);
  });
  it("отказ окна остаётся в готовности и позволяет повторную проверку", () => {
    const f=fixture(); render(<CutsceneReadiness {...f.props} state={{...f.state,error:{code:"display",stepId:null,media:null,message:"Окно заблокировано"}}} />);
    expect(screen.getByRole("alert").textContent).toBe("Окно заблокировано"); expect(f.controller.start).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button",{name:"Закрыть"})); expect(f.props.onClose).toHaveBeenCalledTimes(1);
  });
  it("репетиция не выбирает монитор и явно обещает возврат обоих каналов", () => {
    const f=fixture(); render(<CutsceneReadiness {...f.props} mode="rehearsal" />); expect(screen.queryByRole("combobox")).toBeNull();
    fireEvent.click(screen.getByRole("button",{name:"Начать"})); expect(f.controller.start).toHaveBeenCalledWith({mode:"rehearsal",context:{kind:"library"},screen:null});
    expect(screen.getByText(/Второй экран останется без изменений/)).toBeTruthy();
  });
  it("неизвестный ответ запуска разрешается повтором, без второго начала и закрытия", () => {
    const f=fixture(); render(<CutsceneReadiness {...f.props} state={{...f.state,phase:"error",error:{code:"storage",stepId:null,media:null,message:"Ответ потерян"}}} />);
    expect(screen.queryByRole("button",{name:"Начать"})).toBeNull(); expect(screen.getByRole("button",{name:"Закрыть"}).hasAttribute("disabled")).toBe(true);
    fireEvent.click(screen.getByRole("button",{name:"Проверить результат запуска"})); expect(f.controller.retry).toHaveBeenCalledTimes(1);
  });
});

const host = vi.hoisted(()=>({ state:null as unknown as CutscenePlaybackState, controller:{discover:vi.fn(),select:vi.fn(),dismiss:vi.fn()}, lease:null as unknown }));
vi.mock("../../cutscenes/useCutscenePlayback",()=>({useCutscenePlayback:()=>host}));
vi.mock("../../sound/audioOwnership",()=>({useAudioOwnership:()=>host.lease}));
import { CutsceneLaunchActions } from "./CutsceneLaunchActions";
beforeEach(()=>{vi.clearAllMocks();host.state=fixture().state;host.lease=null;host.controller.discover.mockResolvedValue(false);host.controller.select.mockResolvedValue(true);});
describe("входы из каталога и мастерской",()=>{
  it("выбирает оригинал по ID, без черновика и без запуска",async()=>{
    render(<CutsceneLaunchActions id={13} />);fireEvent.click(screen.getByRole("button",{name:"Показать игрокам"}));
    await waitFor(()=>expect(host.controller.select).toHaveBeenCalledWith(13));expect(screen.getByRole("dialog",{name:"Готовность катсцены"})).toBeTruthy();
  });
  it("каталог предлагает реальный показ без отдельной репетиции",()=>{
    render(<CutsceneLaunchActions id={13} name="Вступление" />);expect(screen.getByRole("button",{name:"Показать катсцену «Вступление»"})).toBeTruthy();expect(screen.queryByRole("button",{name:"Репетиция"})).toBeNull();
  });
  it("активный запуск предлагается восстановить вместо выбора другого",async()=>{
    host.controller.discover.mockResolvedValue(true);render(<CutsceneLaunchActions id={13} />);fireEvent.click(screen.getByRole("button"));
    await waitFor(()=>expect(host.controller.discover).toHaveBeenCalled());expect(host.controller.select).not.toHaveBeenCalled();expect(screen.queryByRole("dialog")).toBeNull();
  });
  it("владеющий звуком прогон блокирует второй запуск",()=>{
    host.lease={owner:{runId:"active"}};render(<CutsceneLaunchActions id={13} rehearsal />);expect(screen.getAllByRole("button").every(button=>button.hasAttribute("disabled"))).toBe(true);
  });

  it("закрывает выбор после регистрации запуска, сохраняя глобальный проигрыватель",async()=>{
    const onStarted=vi.fn(),view=render(<CutsceneLaunchActions id={13} onStarted={onStarted}/>);
    fireEvent.click(screen.getByRole("button",{name:"Показать игрокам"}));await waitFor(()=>expect(host.controller.select).toHaveBeenCalledWith(13));
    host.state={...host.state,run:{endedAt:null} as unknown as CutscenePlaybackState["run"]};view.rerender(<CutsceneLaunchActions id={13} onStarted={onStarted}/>);
    await waitFor(()=>expect(onStarted).toHaveBeenCalledTimes(1));expect(screen.queryByRole("dialog")).toBeNull();
  });
});
