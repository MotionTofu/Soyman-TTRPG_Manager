import { parseStatusTag } from "@shared/litm/status";

/**
 * Что пульт умеет выполнить из скобок последствия (Q12): статус — герою в
 * спотлайте (`self` — самому вызову: «получить *спрятан-2*»; `all` — всем
 * героям), «снять N уровня с *X*» — со своего предела или статуса,
 * «вычеркнуть тег» — у героя. Именованные (**Разоблачение**) — только текст.
 */
export type ConsequenceAction =
  | { kind: "status"; name: string; tier: number; self: boolean; all: boolean }
  | { kind: "reduce"; name: string; by: number }
  | { kind: "scratch" };

const COUNT: Record<string, number> = { один: 1, одна: 1, два: 2, две: 2, три: 3, четыре: 4, пять: 5 };

const REDUCE = /снять\s+(?:(\d|один|одна|два|две|три|четыре|пять)\s+)?уров[а-я]*\s+со?\s+\*([^*]+)\*/gi;
const TOKEN = /(?<!\*)\*([^*\n]+)\*(?!\*)/g;

export function consequenceActions(effect: string | null): ConsequenceAction[] {
  if (!effect) return [];
  const out: ConsequenceAction[] = [];
  for (const m of effect.matchAll(REDUCE)) {
    const n = m[1] ? (COUNT[m[1].toLowerCase()] ?? Number(m[1])) : 1;
    out.push({ kind: "reduce", name: m[2].trim(), by: n });
  }
  const all = /(^|[\s,])всем(\s|$|[,.)])/i.test(effect);
  const seen = new Set<string>();
  for (const m of effect.matchAll(TOKEN)) {
    const s = parseStatusTag(m[1]);
    if (!s || seen.has(`${s.name}-${s.tier}`)) continue;
    seen.add(`${s.name}-${s.tier}`);
    const before = effect.slice(Math.max(0, (m.index ?? 0) - 12), m.index);
    out.push({ kind: "status", name: s.name, tier: s.tier, self: /получить\s*$/i.test(before), all });
  }
  if (/вычеркнуть\s+тег/i.test(effect)) out.push({ kind: "scratch" });
  return out;
}

export function actionLabel(a: ConsequenceAction): string {
  if (a.kind === "status") return `${a.name}-${a.tier}${a.self ? " себе" : a.all ? " всем" : ""}`;
  if (a.kind === "reduce") return `−${a.by} ${a.name}`;
  return "вычеркнуть тег";
}

/**
 * Предел «по смыслу имени» (Q8): тот, где этот статус уже засчитан, или чьё
 * имя с ним одного корня — «напуган» → «Напугать», «изгнан» → «Изгнать».
 * ponytail: общий префикс ≥ 60% короткого слова; не угадает «ранен» → «Убить».
 */
export function limitFor(limits: readonly { name: string; status: string }[], status: string): number | null {
  const norm = (s: string) => s.trim().toLocaleLowerCase("ru").replace(/ё/g, "е");
  const a = norm(status);
  if (!a) return null;
  const same = limits.findIndex((l) => l.status && norm(l.status) === a);
  if (same >= 0) return same;
  let best: number | null = null;
  let bestLen = 0;
  limits.forEach((l, i) => {
    const b = norm(l.name);
    let k = 0;
    while (k < a.length && k < b.length && a[k] === b[k]) k++;
    if (k >= Math.max(3, Math.ceil(0.6 * Math.min(a.length, b.length))) && k > bestLen) {
      best = i;
      bestLen = k;
    }
  });
  return best;
}
