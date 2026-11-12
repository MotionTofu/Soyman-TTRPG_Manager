/** Путешествия LitM (доски Litm-Journey): правило, местности, события, предприятия и общие дорожные виньетки (кн. II). */
import type { CompendiumEntry } from "../../types";

export interface Vignette { name: string; nameEn: string; threat: string; consequences: string[]; blocksPath: boolean }
export interface Journey {
  entry: CompendiumEntry; kind: string; page: string; tags: string[];
  consequences: string[]; benefits: string; vignettes: Vignette[];
}
/** Группа раздела: «Местности», «События», «Предприятия» — с путешествиями; правило и общие виньетки — без. */
export interface JourneyGroup { entry: CompendiumEntry; page: string; journeys: Journey[]; vignetteGroups: VignetteGroup[] }
export interface VignetteGroup { name: string; nameEn: string; intro: string; page: string; vignettes: Vignette[] }

const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
const str = (v: unknown) => (typeof v === "string" ? v : "");
const strs = (v: unknown) => arr<unknown>(v).filter((s): s is string => typeof s === "string" && s !== "");
const byPos = (a: CompendiumEntry, b: CompendiumEntry) => a.position - b.position || a.id - b.id;

const vignettes = (v: unknown): Vignette[] => arr<Record<string, unknown>>(v).map((x) => ({
  name: str(x.name), nameEn: str(x.nameEn), threat: str(x.threat), consequences: strs(x.consequences), blocksPath: x.blocksPath === true,
})).filter((x) => x.name);

/** Группы в порядке книги; путешествия — дети групп. */
export function journeysOf(entries: CompendiumEntry[]): JourneyGroup[] {
  const sorted = [...entries].sort(byPos);
  return sorted.filter((e) => e.parent_id === null).map((g) => ({
    entry: g,
    page: str(g.data?.page),
    journeys: sorted.filter((e) => e.parent_id === g.id).map((e) => ({
      entry: e, kind: str(e.data?.journeyKindRu), page: str(e.data?.page), tags: strs(e.data?.tags),
      consequences: strs(e.data?.consequences), benefits: str(e.data?.benefits), vignettes: vignettes(e.data?.vignettes),
    })),
    vignetteGroups: arr<Record<string, unknown>>(g.data?.groups).map((x) => ({
      name: str(x.name), nameEn: str(x.nameEn), intro: str(x.intro), page: str(x.page), vignettes: vignettes(x.vignettes),
    })),
  }));
}

/** Шаги путешествия: выбранные виньетки по порядку, не больше числа шагов. */
export function toggleStep(picked: number[], index: number, steps: number): number[] {
  if (picked.includes(index)) return picked.filter((i) => i !== index);
  return picked.length < steps ? [...picked, index] : picked;
}
