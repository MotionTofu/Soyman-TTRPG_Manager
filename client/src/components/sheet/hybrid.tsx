import { StateEffect, StateField, type EditorState, type Range, type Text } from "@codemirror/state";
import { Decoration, EditorView, WidgetType, type DecorationSet } from "@codemirror/view";
import { createRoot, type Root } from "react-dom/client";
import { flushSync } from "react-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "../../data/queryClient";
import { MentionText } from "../mentions/MentionText";

// «Гибрид» листа, как в Obsidian (гриллинг 2026-09-29, Q9): всё, где нет
// курсора, нарисовано так же, как в «Чтении», — тем же MentionText; строка
// под курсором раскрывается в разметку. Таблица, блок кода и {quote}…{/quote}
// раскрываются целиком. Щелчок по нарисованному ставит туда курсор,
// Ctrl+щелчок — открывает упоминание или ссылку (Q28).

interface Unit { from: number; to: number; text: string }

/** Куски текста, которые раскрываются вместе. Пустые строки не рисуются. */
export function hybridUnits(doc: Text): Unit[] {
  const units: Unit[] = [];
  const push = (fromLine: number, toLine: number) => {
    const from = doc.line(fromLine).from, to = doc.line(toLine).to;
    units.push({ from, to, text: doc.sliceString(from, to) });
  };
  for (let n = 1; n <= doc.lines; n++) {
    const text = doc.line(n).text;
    if (!text.trim()) continue;
    let end = n;
    const fence = /^\s*(```|~~~)/.exec(text)?.[1];
    if (fence) {
      while (end < doc.lines && !(end > n && doc.line(end).text.trim().startsWith(fence))) end++;
    } else if (/^\s*\|/.test(text)) {
      while (end < doc.lines && /^\s*\|/.test(doc.line(end + 1).text)) end++;
    } else if (text.includes("{quote}") && !text.includes("{/quote}")) {
      while (end < doc.lines && !doc.line(end).text.includes("{/quote}")) end++;
    }
    push(n, end);
    n = end;
  }
  return units;
}

const roots = new WeakMap<HTMLElement, Root>();

class RenderedWidget extends WidgetType {
  readonly text: string;
  constructor(text: string) { super(); this.text = text; }

  eq(other: RenderedWidget) { return other.text === this.text; }

  toDOM(view: EditorView) {
    const outer = document.createElement("div");
    outer.className = "cm-hy";
    const inner = document.createElement("div");
    outer.appendChild(inner);
    const root = createRoot(inner);
    // Синхронно: CodeMirror меряет высоту сразу после toDOM.
    flushSync(() => root.render(
      <QueryClientProvider client={queryClient}><MentionText text={this.text} /></QueryClientProvider>
    ));
    roots.set(outer, root);
    // Обычный щелчок по упоминанию или ссылке не срабатывает — он ставит
    // курсор. Перехват на внешней обёртке идёт раньше обработчиков React.
    outer.addEventListener("click", (event) => {
      if (event.ctrlKey || event.metaKey) return;
      event.preventDefault();
      event.stopPropagation();
    }, true);
    outer.addEventListener("mousedown", (event) => {
      if (event.button !== 0) return;
      // И с Ctrl тоже: иначе браузер сдвинет курсор в текст, кусок
      // раскроется в разметку, и щелчок уже не найдёт упоминания под мышью.
      event.preventDefault();
      if (event.ctrlKey || event.metaKey) return;
      const from = view.posAtDOM(outer);
      const to = from + this.text.length;
      view.dispatch({ selection: { anchor: from } });
      view.focus();
      // Кусок раскрылся в разметку — курсор туда, куда щёлкнули.
      requestAnimationFrame(() => {
        const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
        if (pos != null && pos >= from && pos <= to) view.dispatch({ selection: { anchor: pos } });
      });
    });
    return outer;
  }

  destroy(dom: HTMLElement) {
    const root = roots.get(dom);
    roots.delete(dom);
    // Размонтирование посреди отрисовки React не позволяет — откладывается.
    if (root) setTimeout(() => root.unmount());
  }

  ignoreEvent() { return true; }
}

const setFocus = StateEffect.define<boolean>();

// Без фокуса раскрыто ничего: только что открытый лист целиком нарисован,
// хотя курсор по умолчанию стоит в начале.
function build(state: EditorState, focused: boolean): DecorationSet {
  const ranges = focused ? state.selection.ranges : [];
  const decos: Range<Decoration>[] = [];
  // ponytail: весь документ на каждую правку и движение курсора; на главе в
  // сотни строк незаметно — если понадобится, считать только видимое окно.
  for (const unit of hybridUnits(state.doc)) {
    if (ranges.some(r => r.from <= unit.to && r.to >= unit.from)) continue;
    decos.push(Decoration.replace({ widget: new RenderedWidget(unit.text), block: true }).range(unit.from, unit.to));
  }
  return Decoration.set(decos);
}

const hybridState = StateField.define<{ focused: boolean; decos: DecorationSet }>({
  create: state => ({ focused: false, decos: build(state, false) }),
  update: (value, tr) => {
    const focusEffect = tr.effects.find(e => e.is(setFocus));
    const focused = focusEffect ? focusEffect.value as boolean : value.focused;
    return tr.docChanged || tr.selection || focused !== value.focused
      ? { focused, decos: build(tr.state, focused) }
      : value;
  },
  provide: f => EditorView.decorations.from(f, v => v.decos),
});

export const hybridField = [
  hybridState,
  EditorView.focusChangeEffect.of((_state, focusing) => setFocus.of(focusing)),
];
