// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { CUTSCENE_DEFAULTS } from "@shared/cutscenes/defaults";
import { TeleprompterView, type TeleprompterViewProps } from "./CutsceneTeleprompter";

afterEach(() => cleanup());
function props(): TeleprompterViewProps {
  return { identity: "run-09:1", narration: { text: "# Заголовок\n\n**Важно** и *тихо*.\n\nСледующий абзац.",
    sourceStepId: "first", generation: 1, paused: true, locallyPaused: false, wordsPerMinute: 120 },
    notes: "Только заметка шага", fontSize: CUTSCENE_DEFAULTS.fontSizePx, controlsEnabled: true,
    onTextPaused: vi.fn(), onWordsPerMinute: vi.fn(), onFontSize: vi.fn() };
}
describe("читаемый текст и отдельные заметки", () => {
  it("использует существующее форматирование абзацев, заголовков, жирного и курсива", () => {
    const f = render(<TeleprompterView {...props()} />);
    const prose = f.container.querySelector('.cutscene-teleprompter__prose')!;
    expect(prose.querySelector('.rt-h1')?.textContent).toBe("Заголовок");
    expect(prose.querySelector('strong')?.textContent).toBe("Важно"); expect(prose.querySelector('em')?.textContent).toBe("тихо");
    expect(prose.querySelectorAll('.rt-md-paragraph').length).toBeGreaterThan(1);
    expect((prose as HTMLElement).style.getPropertyValue('--cutscene-reading-font')).toBe("32px");
  });
  it("заметки меняются отдельно при прежнем читаемом тексте и поколении", () => {
    const p = props(), f = render(<TeleprompterView {...p} />); f.rerender(<TeleprompterView {...p} notes="Новые заметки" />);
    const prose = f.container.querySelector('.cutscene-teleprompter__prose')!;
    expect(prose.textContent).not.toContain("заметки"); expect(screen.getByText("Новые заметки")).toBeTruthy();
    expect(f.container.querySelector('[data-text-generation]')?.getAttribute('data-text-generation')).toBe("run-09:1");
  });
  it("убранный текст оставляет заметки и выключает команду его паузы", () => {
    const p = props(); render(<TeleprompterView {...p} narration={{ ...p.narration, text: null }} />);
    expect(screen.getByText("Только заметка шага")).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Пауза текста' }).hasAttribute('disabled')).toBe(true);
  });
  it("ручные настройки вызывают только текстовые команды", () => {
    const p = props(); render(<TeleprompterView {...p} />);
    fireEvent.click(screen.getByRole('button', { name: 'A+' })); fireEvent.click(screen.getByRole('button', { name: 'Медленнее' }));
    fireEvent.click(screen.getByRole('button', { name: 'Пауза текста' }));
    expect(p.onFontSize).toHaveBeenCalledWith(34); expect(p.onWordsPerMinute).toHaveBeenCalledWith(110); expect(p.onTextPaused).toHaveBeenCalledWith(true);
  });
  it("не превращает HTML текста в исполняемую разметку", () => {
    const p = props(), f = render(<TeleprompterView {...p} narration={{ ...p.narration, text: '<script>alert(1)</script>' }} />);
    expect(f.container.querySelector('script')).toBeNull(); expect(f.container.textContent).toContain('<script>alert(1)</script>');
  });
});
