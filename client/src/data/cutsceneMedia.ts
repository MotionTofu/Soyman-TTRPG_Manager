import type { CutsceneMediaAccess, CutsceneMediaKind, CutsceneMediaRef } from "@shared/cutscenes/types";
import { readOnce, afterWriteAnywhere } from "./imperative";
import { write } from "./hooks";

export interface WorkshopMedia {
  ref: CutsceneMediaRef; name: string; mime: string; durationSeconds: number | null; state: "pending" | "ready"; createdAt: string;
}
export type WorkshopMediaSource = { kind: "resource" | "gallery"; id: number };
export const workshopMediaPath = (id: number) => `/cutscenes/${id}/media`;
export const workshopAccessPath = (id: number, mediaId: string) => `${workshopMediaPath(id)}/${encodeURIComponent(mediaId)}/access`;
export const cutsceneMedia = {
  access: (id: number, ref: CutsceneMediaRef) => readOnce<CutsceneMediaAccess>(workshopAccessPath(id, ref.id)),
  async importMedia(id: number, kind: CutsceneMediaKind, source: WorkshopMediaSource): Promise<WorkshopMedia> {
    const result = await write.post<WorkshopMedia>(`${workshopMediaPath(id)}/import`, { kind, source }, { timeoutMs: 120_000 });
    afterWriteAnywhere([{ path: workshopMediaPath(id) }]); return result;
  },
  async upload(id: number, kind: CutsceneMediaKind, file: File): Promise<WorkshopMedia> {
    const form = new FormData(); form.append("file", file);
    const result = await write.post<WorkshopMedia>(`${workshopMediaPath(id)}/${kind}/upload`, form, { timeoutMs: 120_000 });
    afterWriteAnywhere([{ path: workshopMediaPath(id) }]); return result;
  },
};
