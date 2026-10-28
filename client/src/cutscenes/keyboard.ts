export type CutsceneKeyCommand = "next" | "previous" | "pause" | "text" | "menu";
const commands: Readonly<Record<string, CutsceneKeyCommand>> = {
  Space: "next", ArrowLeft: "previous", KeyP: "pause", KeyT: "text", Escape: "menu",
};
function codeOf(event: KeyboardEvent): string {
  return event.code || (event.key === " " ? "Space" : event.key);
}

/** One early capture listener per window; only a mounted GM player can own its commands. */
export class CutsceneKeyboardRouter {
  private readonly target: Window;
  private readonly focused: () => boolean;
  private owners: { invoke: (command: CutsceneKeyCommand) => void }[] = [];
  private held = new Set<string>();
  constructor(target: Window, focused = () => target.document.hasFocus()) {
    this.target = target; this.focused = focused;
    target.addEventListener("keydown", this.down, true);
    target.addEventListener("keyup", this.up, true);
    target.addEventListener("blur", this.blur);
  }
  owns(event: KeyboardEvent): boolean { return this.owners.length > 0 && this.focused() && !!commands[codeOf(event)]; }
  claim(invoke: (command: CutsceneKeyCommand) => void): () => void {
    const owner = { invoke }; this.owners.push(owner);
    return () => { this.owners = this.owners.filter(item => item !== owner); };
  }
  private consume(event: KeyboardEvent): void { event.preventDefault(); event.stopImmediatePropagation(); }
  private down = (event: KeyboardEvent): void => {
    const code = codeOf(event), command = commands[code];
    if (!command || !this.focused()) return;
    const owner = this.owners.at(-1);
    if (!owner) {
      // A held key released after unmount must not activate the underlying button/player.
      if (event.repeat && this.held.has(code)) this.consume(event);
      else this.held.delete(code);
      return;
    }
    this.consume(event);
    if (event.repeat || this.held.has(code)) return;
    this.held.add(code);
    if (!event.isComposing && !event.ctrlKey && !event.altKey && !event.metaKey) owner.invoke(command);
  };
  private up = (event: KeyboardEvent): void => {
    const code = codeOf(event);
    if (!commands[code] || !this.focused()) return;
    if (this.owners.length || this.held.has(code)) this.consume(event);
    this.held.delete(code);
  };
  // Focus changes reset the latch only; they never pause playback or narration.
  private blur = (): void => { this.held.clear(); };
  dispose(): void {
    this.owners = []; this.held.clear();
    this.target.removeEventListener("keydown", this.down, true);
    this.target.removeEventListener("keyup", this.up, true);
    this.target.removeEventListener("blur", this.blur);
  }
}
const routers = new WeakMap<Window, CutsceneKeyboardRouter>();
/** Bootstrap before React mounts any page's capture handlers. Also usable by isolated hosts. */
export function installCutsceneKeyboard(target: Window = window): CutsceneKeyboardRouter {
  let router = routers.get(target);
  if (!router) { router = new CutsceneKeyboardRouter(target); routers.set(target, router); }
  return router;
}
export function cutsceneKeyboardOwns(event: KeyboardEvent): boolean {
  return routers.get(window)?.owns(event) ?? false;
}
