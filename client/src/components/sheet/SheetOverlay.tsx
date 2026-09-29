import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { useConfirm } from "../../hooks/useConfirm";
import { clearFieldDraft, loadFieldDraft, saveFieldDraft } from "../../fieldDrafts";
import { MentionText } from "../mentions/MentionText";
import { SheetEditor } from "./SheetEditor";
import { SheetView, type SheetMode } from "./SheetView";

// Лист поверх рабочей области (гриллинг 2026-09-29, Q11): карточка
// описания, глава, запись кампании и заметка остаются на своих местах
// сжатыми, а текст открывается листом. Навигация и панель поиска приложения
// видны по бокам — оверлей ложится ровно на .app-content. «← Назад» закрывает
// лист; набранное при этом сохраняется (Q10), черновик живёт в
// localStorage с первой буквы.

const MODES: SheetMode[] = ["source", "hybrid", "reading"];

interface Props {
  /** Ключ документа: место прокрутки и черновик. */
  docKey: string;
  /** Над листом: чей это текст, например «Вилла Гралхунд · Описание». */
  caption: string;
  value: string;
  onSave: (value: string) => Promise<unknown>;
  onClose: () => void;
  initialMode: SheetMode;
  defaultSettingId?: number;
}

function useContentBounds(): CSSProperties {
  const [bounds, setBounds] = useState<CSSProperties>({ inset: 0 });
  useLayoutEffect(() => {
    const content = document.querySelector<HTMLElement>(".app-content");
    if (!content) return;
    const measure = () => {
      const r = content.getBoundingClientRect();
      setBounds({ left: r.left, top: r.top, width: r.width, height: r.height });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(content);
    window.addEventListener("resize", measure);
    return () => { ro.disconnect(); window.removeEventListener("resize", measure); };
  }, []);
  return bounds;
}

export function SheetOverlay({ docKey, caption, value, onSave, onClose, initialMode, defaultSettingId }: Props) {
  const draftKey = `sheet:${docKey}`;
  const [saved, setSaved] = useState(value);
  const [draft, setDraftState] = useState(() => loadFieldDraft(draftKey) ?? value);
  const [mode, setMode] = useState<SheetMode>(() => (loadFieldDraft(draftKey) != null && initialMode === "reading" ? "hybrid" : initialMode));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [menuRequest, setMenuRequest] = useState(0);
  const [coarsePointer] = useState(() => window.matchMedia("(pointer: coarse)").matches);
  const [confirmDialog, confirm] = useConfirm();
  const bounds = useContentBounds();
  const dirty = draft !== saved;
  const restored = useRef(loadFieldDraft(draftKey) != null && loadFieldDraft(draftKey) !== value);

  // Сохранённое снаружи (перечитали сущность) — новая точка отсчёта.
  useEffect(() => { setSaved(value); }, [value]);

  function setDraft(next: string) {
    setDraftState(next);
    if (next === saved) clearFieldDraft(draftKey);
    else saveFieldDraft(draftKey, next);
  }

  async function save(): Promise<boolean> {
    if (!dirty) return true;
    setSaving(true);
    setError("");
    try {
      await onSave(draft);
      setSaved(draft);
      clearFieldDraft(draftKey);
      restored.current = false;
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось сохранить");
      return false;
    } finally {
      setSaving(false);
    }
  }

  const saveRef = useRef(save);
  saveRef.current = save;
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "s") return;
      event.preventDefault();
      void saveRef.current();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  async function discard() {
    if (dirty && !await confirm({ message: "Отменить правку? Набранное после последнего сохранения пропадёт.", confirmLabel: "Отменить правку", cancelLabel: "Оставить", danger: true })) return;
    clearFieldDraft(draftKey);
    setDraftState(saved);
    setMode("reading");
  }

  const editing = mode !== "reading";
  const saveTitle = saving ? "Сохраняю…" : dirty ? "Сохранить (Ctrl+S)" : "Сохранено";

  return createPortal(
    <div className="sheet-overlay" style={bounds} role="dialog" aria-label={caption}>
      <SheetView docKey={docKey} contentKey={draft} modes={MODES} mode={mode}
        onMode={next => { if (next === "reading" && dirty) void save(); setMode(next); }}
        back={{ label: "Назад", onClick: () => { void save().then(ok => { if (ok) onClose(); }); } }}
        actions={<>
          {editing && <button type="button" className="sheet-btn sheet-btn--primary" title={saveTitle} aria-label={saveTitle}
            onClick={() => void save()} disabled={!dirty || saving}>✓{dirty && <span className="sheet-btn__dot" />}</button>}
          {editing && <button type="button" className="sheet-btn" title="Отменить правку" aria-label="Отменить правку"
            onClick={() => void discard()}>✕</button>}
          {editing && coarsePointer && <button type="button" className="sheet-btn" title="Форматирование" aria-label="Форматирование"
            onClick={() => setMenuRequest(n => n + 1)}>Aa</button>}
        </>}
        notice={<>
          <p className="sheet-caption">{caption}</p>
          {restored.current && dirty && <p className="sheet-caption" role="status">Черновик восстановлен — он не сохранён, пока не нажать ✓.</p>}
          {error && <p role="alert" className="sheet-caption">{error}</p>}
        </>}>
        {editing
          ? <SheetEditor hybrid={mode === "hybrid"} value={draft} onChange={setDraft} menuRequest={menuRequest} defaultSettingId={defaultSettingId} />
          : draft.trim() ? <MentionText text={draft} /> : <p className="muted">Пусто — переключитесь в «Гибрид», чтобы писать.</p>}
      </SheetView>
      {confirmDialog}
    </div>,
    document.body
  );
}
