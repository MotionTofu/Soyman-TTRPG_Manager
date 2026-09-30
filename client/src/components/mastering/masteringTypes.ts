import type { MasteringNote } from "../../types";

export type MasteringDraft = Pick<MasteringNote, "title" | "content" | "category" | "system_id" | "section_id" | "cover_image">;
export const MASTERING_AFFECTS = [{ kind: "mastering" as const }];
export const MASTERING_CATEGORIES = [
  { key: "prep", label: "Подготовка" },
  { key: "live", label: "Во время игры" },
  { key: "knowledge", label: "База знаний" },
] as const;
