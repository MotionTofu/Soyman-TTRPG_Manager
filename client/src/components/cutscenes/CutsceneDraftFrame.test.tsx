// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
vi.mock('@tanstack/react-query',async importOriginal=>({...await importOriginal<typeof import('@tanstack/react-query')>(),useQueries:()=>[]}));
vi.mock('../presentation/PresentationStage',()=>({PresentationStage:({title,titleSecs}:{title:string;titleSecs:number})=><div data-testid="frame">{title}:{titleSecs}</div>}));
import { emptyComposition } from "../../cutscenes/workshopDraft";
import { CutsceneDraftFrame } from "./CutsceneDraftFrame";
afterEach(cleanup);
describe('предпросмотр кадра мастерской',()=>{
  it('миниатюра не проигрывает большой титр поверх списка шагов',()=>{
    render(<CutsceneDraftFrame id={12} composition={{...emptyComposition(),title:'У ворот'}} />);expect(screen.getByTestId('frame').textContent).toBe(':0');
  });
  it('явный предпросмотр проигрывает титр с авторским временем',()=>{
    render(<CutsceneDraftFrame id={12} playKey={1} composition={{...emptyComposition(),title:'У ворот',title_secs:2.5}} />);expect(screen.getByTestId('frame').textContent).toBe('У ворот:2.5');
  });
});
