// Двигатель силы и участие — словарь подписей (разбор профилей 2026-10-01,
// словарь граф §2). Ключи — те же, что у сервера (server/src/services/
// beingForce.ts); подписи — здесь, в одном месте на все карточки.

export const FORCE_FIELDS = [
  { key: "want", label: "Хочет", core: true },
  { key: "fear", label: "Боится", core: true },
  { key: "knows", label: "Знает", core: true },
  { key: "can", label: "Может", core: true },
  { key: "cannot", label: "Не может", core: true },
  { key: "needs", label: "Нуждается", core: true },
  { key: "means", label: "Средства", core: false },
  { key: "interest", label: "Интерес", core: false },
  { key: "stance", label: "Заявленная позиция", core: false },
  { key: "pressure", label: "Под давлением", core: false },
] as const;

export type ForceKey = (typeof FORCE_FIELDS)[number]["key"];

/** В узких местах (~280–300 px, Q12): только эти три, остальное — «ещё». */
export const NARROW_FORCE_KEYS: readonly ForceKey[] = ["want", "fear", "needs"];

export const PARTICIPATION_FIELDS = [
  { key: "goal", label: "Текущая цель" },
  { key: "plan", label: "План" },
  { key: "without", label: "Без вмешательства" },
  { key: "if_help", label: "Если помочь" },
] as const;

export type ParticipationKey = (typeof PARTICIPATION_FIELDS)[number]["key"];

export function hasForce(force: Partial<Record<string, string>> | undefined | null): boolean {
  return !!force && Object.values(force).some((v) => !!v?.trim());
}
