import { PRESENTATION_TRANSITIONS } from "../presentation";
import type { CutsceneAudioCommand, CutsceneComposition, CutsceneDocument, CutsceneMediaCheck,
  CutsceneMediaRef, CutsceneMediaUse, CutsceneParseResult, CutsceneReadiness, CutsceneValidationIssue } from "./types";

type Check = (value: unknown, path: string, issues: CutsceneValidationIssue[]) => void;
type Fields = Readonly<Record<string, Check>>;

function issue(code: string, path: string, message: string, stepId: string | null = null): CutsceneValidationIssue {
  return { code, path, message, stepId };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function at(path: string, key: string | number): string {
  return path ? `${path}.${key}` : String(key);
}

function object(fields: Fields): Check {
  return (value, path, issues) => {
    if (!isRecord(value)) {
      issues.push(issue("structure.object", path, "Ожидался объект."));
      return;
    }
    for (const key of Object.keys(value)) {
      if (!Object.hasOwn(fields, key)) issues.push(issue("structure.unknown-field", at(path, key), "Неизвестное поле."));
    }
    for (const [key, check] of Object.entries(fields)) check(value[key], at(path, key), issues);
  };
}

function oneOf(values: readonly (string | number)[]): Check {
  return (value, path, issues) => {
    if (!values.some((candidate) => candidate === value)) {
      issues.push(issue("structure.value", path, "Недопустимое значение."));
    }
  };
}

function text(nonEmpty = false): Check {
  return (value, path, issues) => {
    if (typeof value !== "string") issues.push(issue("structure.string", path, "Ожидалась строка."));
    else if (nonEmpty && !value.trim()) issues.push(issue("structure.empty", path, "Значение не должно быть пустым."));
  };
}

function number(min: number, max = Infinity, inclusiveMin = true, integer = false): Check {
  return (value, path, issues) => {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      issues.push(issue("number.finite", path, "Ожидалось конечное число."));
    } else if ((inclusiveMin ? value < min : value <= min) || value > max || (integer && !Number.isSafeInteger(value))) {
      issues.push(issue("number.range", path, "Число вне допустимого диапазона."));
    }
  };
}

const bool: Check = (value, path, issues) => {
  if (typeof value !== "boolean") issues.push(issue("structure.boolean", path, "Ожидалось логическое значение."));
};
const optional = (check: Check): Check => (value, path, issues) => { if (value !== undefined) check(value, path, issues); };
const nullable = (check: Check): Check => (value, path, issues) => { if (value !== null) check(value, path, issues); };
const list = (check: Check): Check => (value, path, issues) => {
  if (!Array.isArray(value)) { issues.push(issue("structure.array", path, "Ожидался массив.")); return; }
  // Index iteration also rejects holes in an in-memory sparse array.
  for (let index = 0; index < value.length; index++) check(value[index], at(path, index), issues);
};
const variant = (key: string, variants: Readonly<Record<string, Check>>): Check => (value, path, issues) => {
  if (!isRecord(value)) { issues.push(issue("structure.object", path, "Ожидался объект.")); return; }
  const tag = value[key];
  if (typeof tag !== "string" || !Object.hasOwn(variants, tag)) {
    issues.push(issue("structure.value", at(path, key), "Неизвестный вид команды."));
    return;
  }
  variants[tag](value, path, issues);
};

const visualTransition = object({ kind: oneOf(PRESENTATION_TRANSITIONS), durationMs: number(0) });
const audioTransition = object({ mode: oneOf(["crossfade", "sequential"]), fadeOutMs: number(0), fadeInMs: number(0) });
const media = (kind: "image" | "audio"): Check => object({ kind: oneOf([kind]), id: text(true) });
const imageLayer = object({
  id: text(true), name: text(), image: media("image"), visible: bool,
  position: number(0, Infinity, true, true), x_pct: number(-Infinity), y_pct: number(-Infinity),
  w_pct: number(0, Infinity, false), h_pct: number(0, Infinity, false),
});
const composition = object({
  background: nullable(media("image")), layers: list(imageLayer),
  title: text(), title_secs: number(0), fade_ms: number(0),
} satisfies Record<keyof CutsceneComposition, Check>);
const loopTransition = variant("mode", {
  cut: object({ mode: oneOf(["cut"]) }),
  crossfade: object({ mode: oneOf(["crossfade"]), durationMs: number(0) }),
  sequential: object({ mode: oneOf(["sequential"]), fadeOutMs: number(0), fadeInMs: number(0) }),
});
const audioCommand = object({
  id: text(true), audio: media("audio"), startSeconds: number(0), endSeconds: nullable(number(0, Infinity, false)),
  volume: number(0, 1), transition: audioTransition,
  loop: object({ enabled: bool, transition: loopTransition }), endFadeOutMs: number(0),
} satisfies Record<keyof CutsceneAudioCommand, Check>);
const keep = object({ action: oneOf(["keep"]) });
const step = object({
  id: text(true), name: optional(text()), notes: text(),
  image: variant("action", {
    keep, clear: object({ action: oneOf(["clear"]), transition: visualTransition }),
    replace: object({ action: oneOf(["replace"]), composition, transition: visualTransition }),
  }),
  audio: variant("action", {
    keep, clear: object({ action: oneOf(["clear"]), fadeOutMs: number(0) }),
    replace: object({ action: oneOf(["replace"]), command: audioCommand }),
  }),
  text: variant("action", { keep, clear: object({ action: oneOf(["clear"]) }),
    replace: object({ action: oneOf(["replace"]), text: text() }) }),
});
const documentCheck = object({
  version: (value, path, issues) => {
    if (value !== 1) issues.push(issue("document.version", path, "Версия документа не поддерживается."));
  },
  name: text(true), description: text(), steps: list(step),
  settings: object({
    audioScope: oneOf(["music", "all"]), wordsPerMinute: number(0, Infinity, false),
    finish: object({ image: oneOf(["restore", "keep", "black"]), audio: oneOf(["restore", "keep", "silence"]),
      imageTransition: visualTransition, audioTransition }),
  }),
} satisfies Record<keyof CutsceneDocument, Check>);

/** Saving validates structure; empty content is allowed, invalid numbers/IDs are not. */
export function validateCutsceneDocument(value: unknown): readonly CutsceneValidationIssue[] {
  const issues: CutsceneValidationIssue[] = [];
  documentCheck(value, "", issues);
  if (!isRecord(value) || !Array.isArray(value.steps)) return issues;
  const steps = value.steps;
  const stepIds = new Set<string>();
  const commandIds = new Set<string>();
  steps.forEach((candidate: unknown, index: number) => {
    if (!isRecord(candidate)) return;
    const path = `steps.${index}`;
    if (typeof candidate.id === "string") {
      if (stepIds.has(candidate.id)) issues.push(issue("identity.duplicate-step", `${path}.id`, "ID шага повторяется."));
      stepIds.add(candidate.id);
    }
    if (isRecord(candidate.audio) && candidate.audio.action === "replace" && isRecord(candidate.audio.command)) {
      const command = candidate.audio.command;
      if (typeof command.id === "string") {
        if (commandIds.has(command.id)) issues.push(issue("identity.duplicate-command", `${path}.audio.command.id`, "ID музыкальной команды повторяется."));
        commandIds.add(command.id);
      }
      if (typeof command.startSeconds === "number" && typeof command.endSeconds === "number" &&
          command.endSeconds <= command.startSeconds) {
        issues.push(issue("fragment.order", `${path}.audio.command.endSeconds`, "Конец фрагмента должен быть позже начала."));
      }
    }
    if (isRecord(candidate.image) && candidate.image.action === "replace" && isRecord(candidate.image.composition) &&
        Array.isArray(candidate.image.composition.layers)) {
      const layerIds = new Set<string>();
      candidate.image.composition.layers.forEach((layer: unknown, layerIndex: number) => {
        if (!isRecord(layer) || typeof layer.id !== "string") return;
        if (layerIds.has(layer.id)) issues.push(issue("identity.duplicate-layer", `${path}.image.composition.layers.${layerIndex}.id`, "ID слоя повторяется."));
        layerIds.add(layer.id);
      });
    }
  });
  return issues.map((entry) => {
    const index = /^steps\.(\d+)(?:\.|$)/.exec(entry.path)?.[1];
    const candidate: unknown = index === undefined ? null : steps[Number(index)];
    return { ...entry, stepId: isRecord(candidate) && typeof candidate.id === "string" ? candidate.id : null };
  });
}

export function parseCutsceneDocument(raw: unknown): CutsceneParseResult<CutsceneDocument> {
  let value = raw;
  if (typeof raw === "string") {
    try { value = JSON.parse(raw) as unknown; }
    catch { return { ok: false, issues: [issue("json.syntax", "", "Некорректный JSON.")] }; }
  }
  const issues = validateCutsceneDocument(value);
  return issues.length ? { ok: false, issues } : { ok: true, value: value as CutsceneDocument };
}

/** Every authored file is checked, including layers hidden in the composition. */
export function collectCutsceneMediaUses(document: CutsceneDocument): readonly CutsceneMediaUse[] {
  const uses: CutsceneMediaUse[] = [];
  document.steps.forEach((current, index) => {
    const add = (ref: CutsceneMediaRef, path: string) => uses.push({ ref, stepId: current.id, path: `steps.${index}.${path}` });
    if (current.image.action === "replace") {
      if (current.image.composition.background !== null) add(current.image.composition.background, "image.composition.background");
      current.image.composition.layers.forEach((layer, layerIndex) => add(layer.image, `image.composition.layers.${layerIndex}.image`));
    }
    if (current.audio.action === "replace") add(current.audio.command.audio, "audio.command.audio");
  });
  return uses;
}

/** No IO: callers must supply fresh checks; an unchecked reference is not ready. */
export function checkCutsceneReadiness(raw: unknown, mediaChecks: readonly CutsceneMediaCheck[] = []): CutsceneReadiness {
  const parsed = parseCutsceneDocument(raw);
  if (!parsed.ok) return { ready: false, issues: parsed.issues };
  const document = parsed.value;
  const issues: CutsceneValidationIssue[] = [];
  const hasContent = document.steps.some((current) =>
    current.audio.action === "replace" || (current.text.action === "replace" && current.text.text.trim() !== "") ||
    (current.image.action === "replace" && (current.image.composition.background !== null ||
      current.image.composition.layers.length > 0 || current.image.composition.title.trim() !== "")));
  if (!hasContent) issues.push(issue("readiness.empty", "steps", "Для запуска нужен хотя бы один шаг с изображением, звуком или текстом."));
  const key = (ref: CutsceneMediaRef) => `${ref.kind}:${ref.id}`;
  const checks = new Map<string, CutsceneMediaCheck>();
  for (const check of mediaChecks) {
    if (checks.has(key(check.ref))) issues.push(issue("media.duplicate-check", "mediaChecks", "Повторная проверка одного материала."));
    checks.set(key(check.ref), check);
  }
  for (const use of collectCutsceneMediaUses(document)) {
    const check = checks.get(key(use.ref));
    if (!check || check.status !== "ready") {
      issues.push(issue(`media.${check?.status ?? "unchecked"}`, use.path, "Материал не готов к воспроизведению.", use.stepId));
      continue;
    }
    if (use.ref.kind !== "audio") continue;
    const duration = check.durationSeconds;
    if (typeof duration !== "number" || !Number.isFinite(duration) || duration <= 0) {
      issues.push(issue("media.duration", use.path, "Не определена длительность аудио.", use.stepId));
      continue;
    }
    const current = document.steps.find((entry) => entry.id === use.stepId)!;
    if (current.audio.action === "replace" &&
        (current.audio.command.startSeconds >= duration ||
          (current.audio.command.endSeconds !== null && current.audio.command.endSeconds > duration))) {
      issues.push(issue("fragment.bounds", use.path, "Фрагмент выходит за длительность аудио.", use.stepId));
    }
  }
  return issues.length ? { ready: false, issues } : { ready: true, document };
}
