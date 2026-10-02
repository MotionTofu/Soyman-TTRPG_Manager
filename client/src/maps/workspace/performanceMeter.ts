/** Transient measurements. HUD updates never rerender the editor/canvas. */
export class WorkspacePerformanceMeter {
  enabled = true;
  modelMs = 0;
  private draws: number[] = [];
  recordDraw(ms: number) { if (this.enabled) this.draws.push(ms); }
  takeDraws() { const draws = this.draws; this.draws = []; return draws; }
}
