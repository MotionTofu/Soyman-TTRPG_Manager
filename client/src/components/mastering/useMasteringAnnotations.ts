import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { useAction, useResource, write } from "../../data/hooks";
import { getCachedUser } from "../../api/currentUser";
import { useConfirm } from "../../hooks/useConfirm";
import { captureTextSelection, EMPTY_TEXT_ANCHOR, resolveTextAnchor, textAnchorRange, type TextNote, type TextNoteDraft } from "./textNotes";

const NO_NOTES: TextNote[] = [];
export type LocatedTextNote = TextNote & { top: number; located: boolean };
type Composer = { id: string | null; draft: TextNoteDraft; body: string; original: string };
export function useMasteringAnnotations(bookId: number, content: string | undefined, prose: RefObject<HTMLDivElement | null>, highlights: RefObject<HTMLDivElement | null>, sourcePath?: string) {
  const path = sourcePath ?? `/mastering/${bookId}/notes`;
  const query = useResource<TextNote[]>(path);
  const notes = query.data ?? NO_NOTES;
  const run = useAction();
  const [dialog, confirm] = useConfirm();
  const preferenceKey = `masteringNotes:${getCachedUser()?.id ?? "gm"}:${sourcePath??bookId}`;
  const [preferences, setPreferences] = useState(() => {
    try { const stored = JSON.parse(localStorage.getItem(preferenceKey) ?? "null"); if (stored) return { open: !!stored.open, mode: stored.mode === "list" ? "list" as const : "margins" as const, highlights: stored.highlights !== false }; } catch { /* локальные настройки необязательны */ }
    return { open: (document.querySelector(".app-content")?.clientWidth ?? innerWidth) >= 1100, mode: "margins" as "margins" | "list", highlights: true };
  });
  useEffect(() => { try { localStorage.setItem(preferenceKey, JSON.stringify(preferences)); } catch { /* приватный режим */ } }, [preferences, preferenceKey]);
  const [locatedNotes, setLocatedNotes] = useState<LocatedTextNote[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [selection, setSelection] = useState<TextNoteDraft | null>(null);
  const [reattachId, setReattachId] = useState<string | null>(null);
  const [composer, setComposer] = useState<Composer | null>(null);
  const [saving, setSaving] = useState(false);
  const [openedId, setOpenedId] = useState<string | null>(null);
  const opened = locatedNotes.find(note => note.id === openedId);
  const selectionButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const root = prose.current; if (!root) return;
    let timer = 0;
    const capture = () => {
      const draft = captureTextSelection(root);
      setSelection(previous => JSON.stringify(previous) === JSON.stringify(draft) ? previous : draft);
    };
    const schedule = () => { clearTimeout(timer); timer = window.setTimeout(capture, 100); };
    document.addEventListener("selectionchange", schedule);
    root.addEventListener("pointerup", schedule);
    return () => { clearTimeout(timer); document.removeEventListener("selectionchange", schedule); root.removeEventListener("pointerup", schedule); };
  }, [prose, content]);
  useLayoutEffect(() => {
    const button = selectionButton.current;
    const root = prose.current;
    const range = window.getSelection()?.rangeCount ? window.getSelection()!.getRangeAt(0) : null;
    if (!button || !range || !root) return;
    const box = range.getBoundingClientRect();
    const area = root.closest<HTMLElement>(".app-content")?.getBoundingClientRect() ?? { left: 0, right: innerWidth, top: 0, bottom: innerHeight };
    button.style.setProperty("--selection-left", `${Math.max(area.left + 12, Math.min(area.right - button.offsetWidth - 12, box.left))}px`);
    button.style.setProperty("--selection-top", `${Math.max(area.top + 12, Math.min(area.bottom - button.offsetHeight - 60, box.bottom + 8))}px`);
  }, [selection, selectionButton, prose]);

  useLayoutEffect(() => {
    const root = prose.current, layer = highlights.current;
    if (!root || !layer) return;
    const measure = () => {
      const text = root.textContent ?? "", origin = root.getBoundingClientRect();
      const fragment = document.createDocumentFragment();
      const next = notes.map(note => {
        const anchor = resolveTextAnchor(text, note);
        const range = anchor ? textAnchorRange(root, anchor) : null;
        const rects = range && typeof range.getClientRects === "function" ? [...range.getClientRects()] : [];
        if (preferences.highlights) for (const box of rects) {
          if (box.width < 1 || box.height < 1) continue;
          const mark = document.createElement("span");
          mark.className = `mastering-text-highlight${note.id === activeId ? " is-active" : ""}`;
          mark.style.left = `${box.left - origin.left}px`; mark.style.top = `${box.top - origin.top}px`;
          mark.style.width = `${box.width}px`; mark.style.height = `${box.height}px`;
          fragment.append(mark);
        }
        return { ...note, located: !!range, needs_reattach: !!note.anchor && !range, top: rects[0] ? rects[0].top - origin.top : 0 };
      });
      layer.replaceChildren(fragment);
      setLocatedNotes(previous => JSON.stringify(previous) === JSON.stringify(next) ? previous : next);
    };
    measure();
    const observer = new ResizeObserver(measure); observer.observe(root);
    window.addEventListener("resize", measure);
    return () => { observer.disconnect(); window.removeEventListener("resize", measure); };
  }, [notes, content, prose, highlights, preferences.highlights, activeId]);

  function openComposer(note?: TextNote, draft = note ?? EMPTY_TEXT_ANCHOR) {
    setComposer({ id: note?.id ?? null, draft, body: note?.body ?? "", original: note?.body ?? "" });
    setSelection(null); window.getSelection()?.removeAllRanges();
    setPreferences(previous => ({ ...previous, open: true }));
  }
  async function closeComposer() {
    if (saving) return;
    if (composer?.body !== composer?.original && !await confirm({ message: "Закрыть заметку без сохранения?", confirmLabel: "Закрыть без сохранения" })) return;
    setComposer(null);
  }
  async function save() {
    if (!composer?.body.trim() || saving) return;
    setSaving(true);
    try {
      const result = await run(() => composer.id ? write.put(`${path}/${composer.id}`, { body: composer.body }) : write.post(path, { ...composer.draft, body: composer.body }), { affects: [{ path }, {path:"/book-library"}], retry: false });
      if (result !== undefined) setComposer(null);
    } finally { setSaving(false); }
  }
  async function useSelection() {
    if (!selection || saving) return;
    if (!reattachId) { openComposer(undefined, selection); return; }
    setSaving(true);
    try {
      const result = await run(() => write.put(`${path}/${reattachId}`, selection), { affects: [{ path }, {path:"/book-library"}] });
      if (result !== undefined) { setReattachId(null); setSelection(null); window.getSelection()?.removeAllRanges(); }
    } finally { setSaving(false); }
  }
  function locate(note: TextNote) {
    const root = prose.current; if (!root) return;
    const anchor = resolveTextAnchor(root.textContent ?? "", note);
    const range = anchor ? textAnchorRange(root, anchor) : null;
    if (!range) return;
    const source = root.closest<HTMLElement>(".app-content");
    const box = range.getBoundingClientRect();
    const toolbar = root.closest(".mastering-reader")?.querySelector(".mastering-reader__toolbar")?.getBoundingClientRect();
    const distance = box.top - (toolbar?.bottom ?? 0) - 32;
    const behavior = matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" as const : "smooth" as const;
    if (source) source.scrollBy({ top: distance, behavior }); else window.scrollBy({ top: distance, behavior });
    setActiveId(note.id);
  }
  const actions = {
    onHover: setActiveId, onLocate: locate,
    onEdit: (note: TextNote) => { setOpenedId(null); openComposer(note); },
    onDelete: async (note: TextNote) => { if (await confirm({ message: "Удалить заметку?", confirmLabel: "Удалить", danger: true })) { await run(() => write.del(`${path}/${note.id}`), { affects: [{ path }, {path:"/book-library"}] }); setOpenedId(null); } },
    onReattach: (note: TextNote) => { setReattachId(note.id); setOpenedId(null); },
  };
  return { query, notes: locatedNotes, preferences, setPreferences, activeId, actions, opened, setOpenedId, composer, setComposer, closeComposer, save, saving, selection, selectionButton, useSelection, openComposer, reattachId, setReattachId, dialog };
}
