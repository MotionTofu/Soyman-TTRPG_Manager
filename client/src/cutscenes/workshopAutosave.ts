import type { CutsceneDocument, CutsceneOriginal } from "@shared/cutscenes/types";
import { validateCutsceneDocument } from "@shared/cutscenes/validate";
import { cutscenes } from "../data/cutscenes";
import { dismissNotice, showSaveError } from "../data/notices";
import { mergeWorkshopDraft, sameDraft, withWorkshopValue, workshopValueAt, type DraftPath } from "./workshopDraft";

export interface WorkshopState {
  readonly draft: CutsceneDocument;
  readonly saved: CutsceneOriginal;
  readonly status: "saved" | "pending" | "saving" | "error";
  readonly error: string | null;
}
type Save = (id: number, base: CutsceneDocument, document: CutsceneDocument) => Promise<CutsceneOriginal>;

/** One in-flight write, coalesced later edits. Retained across route changes so pending work can finish. */
export class WorkshopAutosave {
  private state: WorkshopState;
  private base: CutsceneDocument;
  private remote: CutsceneOriginal;
  private focus: DraftPath | null = null;
  private listeners = new Set<() => void>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private flight: Promise<void> | null = null;
  private notice: number | null = null;
  private save: Save;
  private delay: number;
  constructor(original: CutsceneOriginal, save: Save = cutscenes.saveDraft, delay = 500) {
    this.save = save; this.delay = delay;
    this.base = original.document; this.remote = original;
    this.state = { draft: original.document, saved: original, status: "saved", error: null };
  }
  snapshot = () => this.state;
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  private publish(patch: Partial<WorkshopState>) { this.state = { ...this.state, ...patch }; this.listeners.forEach(fn => fn()); }
  receive(original: CutsceneOriginal) {
    if (original.savedVersion === this.remote.savedVersion) return;
    this.remote = original;
    if (this.flight) return;
    this.rebase();
  }
  private rebase() {
    const draft = mergeWorkshopDraft(this.base, this.state.draft, this.remote.document, this.focus);
    this.base = mergeWorkshopDraft(this.base, this.base, this.remote.document, this.focus);
    this.publish({ draft, saved: this.remote });
    if (!this.dirty()) { this.clearNotice(); this.publish({ status: "saved", error: null }); }
  }
  setFocus(path: DraftPath | null) { this.focus = path; if (!this.flight) this.rebase(); }
  edit(update: (document: CutsceneDocument) => CutsceneDocument) {
    const draft = update(this.state.draft); if (sameDraft(draft, this.state.draft)) return;
    // A field may still display its old value while a remote change waits for blur.
    // Once the user edits it, compare against the actual remote value, even if they type the old value again.
    if (this.focus && !sameDraft(workshopValueAt(this.state.draft,this.focus),workshopValueAt(draft,this.focus))) {
      this.base = withWorkshopValue(this.base,this.focus,workshopValueAt(this.remote.document,this.focus));
    }
    this.publish({ draft, status: this.flight ? "saving" : "pending", error: null }); this.schedule();
  }
  dirty = () => !sameDraft(this.base, this.state.draft);
  private schedule() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => { this.timer = null; void this.flush(); }, this.delay);
  }
  flush = (): Promise<void> => {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    if (this.flight) return this.flight;
    if (!this.dirty()) { this.clearNotice(); this.publish({ status: "saved", error: null }); return Promise.resolve(); }
    const base = this.base, submitted = this.state.draft;
    const issues = validateCutsceneDocument(submitted);
    if (issues.length) { this.fail(issues[0].path === "name" ? "Укажите название катсцены." : issues[0].message); return Promise.resolve(); }
    this.publish({ status: "saving", error: null });
    this.flight = this.save(this.state.saved.id, base, submitted).then(saved => {
      // Edits made since submission survive; clean fields take the actual server response.
      const draft = mergeWorkshopDraft(submitted, this.state.draft, saved.document, this.focus);
      this.base = mergeWorkshopDraft(submitted, submitted, saved.document, this.focus);
      this.remote = saved;
      this.publish({ draft, saved, status: sameDraft(this.base, draft) ? "saved" : "pending", error: null });
      this.clearNotice();
    }).catch(error => { this.fail(error instanceof Error ? error.message : String(error)); }).finally(() => {
      this.flight = null;
      if (this.state.status !== "error" && this.dirty()) this.schedule();
    });
    return this.flight;
  };
  private fail(error: string) {
    this.publish({ status: "error", error });
    if (this.notice !== null) dismissNotice(this.notice);
    this.notice = showSaveError(`Катсцена не сохранилась: ${error}`, this.flush);
  }
  private clearNotice() { if (this.notice !== null) { dismissNotice(this.notice); this.notice = null; } }
}

const drafts = new Map<number, WorkshopAutosave>();
export function workshopAutosave(original: CutsceneOriginal): WorkshopAutosave {
  let draft = drafts.get(original.id);
  if (!draft) { draft = new WorkshopAutosave(original); drafts.set(original.id, draft); }
  return draft;
}
