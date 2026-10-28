import { useSyncExternalStore } from "react";
import { cutsceneOwnedAudioChannels } from "@shared/cutscenes/defaults";
import type { CutsceneAudioScope, CutsceneOwnedAudioChannel } from "@shared/cutscenes/types";

export interface AudioOwner { readonly runId: string; readonly controllerId: string }
export interface AudioLease { readonly owner: AudioOwner; readonly scope: CutsceneAudioScope }
const KEY = "soyman.cutscene.audio-owner";
const CHANNEL = "soyman-cutscene-audio-ownership";
const same = (a: AudioOwner | null | undefined, b: AudioOwner | null | undefined) =>
  !!a && !!b && a.runId === b.runId && a.controllerId === b.controllerId;

export class AudioOwnershipError extends Error {}

/** A local application gate, mirrored to other windows. 07 arbitrates live runs on the server. */
export class AudioAuthority {
  private lease: AudioLease | null = null;
  private permit: AudioOwner | null = null;
  private listeners = new Set<() => void>();
  private epochs = { background: 0, ambient: 0, weather: 0, stinger: 0 };
  private persist?: (lease: AudioLease | null) => void;
  constructor(persist?: (lease: AudioLease | null) => void) { this.persist = persist; }
  getSnapshot = () => this.lease;
  subscribe = (callback: () => void) => { this.listeners.add(callback); return () => { this.listeners.delete(callback); }; };
  epoch(channel: CutsceneOwnedAudioChannel): number { return this.epochs[channel]; }
  owns(channel: CutsceneOwnedAudioChannel): boolean {
    return !!this.lease && cutsceneOwnedAudioChannels(this.lease.scope).includes(channel);
  }
  allows(channel: CutsceneOwnedAudioChannel): boolean {
    return !this.owns(channel) || same(this.permit, this.lease?.owner);
  }
  assert(owner: AudioOwner): void {
    if (!same(this.lease?.owner, owner)) throw new AudioOwnershipError("Управление звуком принадлежит другому запуску");
  }
  withOwner<T>(owner: AudioOwner, apply: () => T): T {
    this.assert(owner);
    const previous = this.permit; this.permit = owner;
    try { return apply(); } finally { this.permit = previous; }
  }
  claim(owner: AudioOwner, scope: CutsceneAudioScope): void {
    if (this.lease && !same(this.lease.owner, owner)) throw new AudioOwnershipError("Звук занят катсценой");
    if (this.lease && this.lease.scope !== scope) throw new AudioOwnershipError("Режим захвата уже зафиксирован");
    this.replace({ owner: { ...owner }, scope });
  }
  release(owner: AudioOwner): void { this.assert(owner); this.replace(null); }
  transfer(owner: AudioOwner, next: AudioOwner): void {
    this.assert(owner); this.replace({ owner: { ...next }, scope: this.lease!.scope });
  }
  private replace(next: AudioLease | null): void { this.receive(next); this.persist?.(next); }
  receive(next: AudioLease | null): void {
    if (JSON.stringify(next) === JSON.stringify(this.lease)) return;
    for (const key of Object.keys(this.epochs) as CutsceneOwnedAudioChannel[]) {
      if (this.owns(key) || (next && cutsceneOwnedAudioChannels(next.scope).includes(key))) this.epochs[key]++;
    }
    this.lease = next ? { owner: { ...next.owner }, scope: next.scope } : null;
    this.listeners.forEach(callback => callback());
  }
}

function parse(raw: string | null): AudioLease | null {
  try {
    const value = raw ? JSON.parse(raw) : null;
    return value && (value.scope === "all" || value.scope === "music") &&
      typeof value.owner?.runId === "string" && typeof value.owner?.controllerId === "string"
      ? { scope: value.scope, owner: { runId: value.owner.runId, controllerId: value.owner.controllerId } } : null;
  } catch { return null; }
}
let channel: BroadcastChannel | null = null;
export const audioAuthority = new AudioAuthority(lease => {
  try { if (lease) localStorage.setItem(KEY, JSON.stringify(lease)); else localStorage.removeItem(KEY); } catch { /* local gate still works */ }
  channel?.postMessage(lease);
});
if (typeof window !== "undefined") {
  try { audioAuthority.receive(parse(localStorage.getItem(KEY))); } catch { /* unavailable storage */ }
  if (typeof BroadcastChannel !== "undefined") {
    channel = new BroadcastChannel(CHANNEL);
    (channel as unknown as { unref?: () => void }).unref?.();
    channel.addEventListener("message", e => audioAuthority.receive(parse(JSON.stringify(e.data))));
  }
  window.addEventListener("storage", e => { if (e.key === KEY) audioAuthority.receive(parse(e.newValue)); });
}
export function useAudioOwnership(): AudioLease | null {
  return useSyncExternalStore(audioAuthority.subscribe, audioAuthority.getSnapshot, () => null);
}
