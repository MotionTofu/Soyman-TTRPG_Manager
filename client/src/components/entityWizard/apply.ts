import { api } from "../../api/client";
import type { DraftRelation } from "./fields";
import type { WizardDraft } from "./types";

// Шаги визарда собирают черновик, а запросы уходят пачкой после создания
// сущности — до этого момента ей ещё некуда что-либо привязывать. Каждый
// помощник здесь молча пропускает пустое, чтобы create() у типов читался как
// список «что ещё приложить», без проверок на каждой строке.

export function str(draft: WizardDraft, key: string): string {
  const value = draft[key];
  return typeof value === "string" ? value : "";
}

export function ids(draft: WizardDraft, key: string): number[] {
  const value = draft[key];
  return Array.isArray(value) ? (value as number[]) : [];
}

export function strings(draft: WizardDraft, key: string): string[] {
  const value = draft[key];
  return Array.isArray(value) ? (value as string[]) : [];
}

export function file(draft: WizardDraft, key: string): File | null {
  const value = draft[key];
  return value instanceof File ? value : null;
}

export function relations(draft: WizardDraft, key: string): DraftRelation[] {
  const value = draft[key];
  return Array.isArray(value) ? (value as DraftRelation[]) : [];
}

export async function uploadAvatar(path: string, avatar: File | null): Promise<void> {
  if (!avatar) return;
  const form = new FormData();
  form.append("file", avatar);
  await api.post(path, form);
}

// Связь сущности с событиями хроники: отдельной таблицы у неё нет, всё лежит
// в общем графе (generic_links), где тип setting_event уже используется.
export async function linkEvents(
  fromType: string,
  fromId: number,
  eventIds: number[]
): Promise<void> {
  for (const eventId of eventIds) {
    await api.post("/links", {
      from_type: fromType,
      from_id: fromId,
      to_type: "setting_event",
      to_id: eventId,
    });
  }
}

// Та же связь с другой стороны: событие только что создано, а привязать к
// нему нужно уже существующих участников. Направление то же (сущность →
// событие), чтобы в графе не появилось двух видов одной и той же связи.
export async function linkEventParticipants(
  eventId: number,
  participantType: string,
  participantIds: number[]
): Promise<void> {
  for (const id of participantIds) {
    await api.post("/links", {
      from_type: participantType,
      from_id: id,
      to_type: "setting_event",
      to_id: eventId,
    });
  }
}

export async function createRelations(
  fromType: string,
  fromId: number,
  list: DraftRelation[]
): Promise<void> {
  for (const r of list) {
    await api.post("/entity-relations", {
      from_type: fromType,
      from_id: fromId,
      to_type: r.to_type,
      to_id: r.to_id,
      tone: r.tone,
      label: r.label,
    });
  }
}
