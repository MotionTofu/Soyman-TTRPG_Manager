import { describe, expect, it } from "vitest";
import {
  captureCutsceneVersion, checkCutsceneReadiness, collectCutsceneMediaUses,
  createCutsceneAudioCommand, createCutsceneDocument, createCutsceneSettings,
  createCutsceneStep, createCutsceneVisualTransition, CUTSCENE_DEFAULTS, cutsceneStepLabel, cutsceneStepNameFromFile,
  cutsceneOwnedAudioChannels, parseCutsceneDocument, projectCutscenePlayerFrame,
  resolveCutsceneStep, validateCutsceneDocument,
  type CutsceneComposition, type CutsceneDocument, type CutsceneMediaCheck,
  type CutsceneStep,
} from "./index";

const image = { kind: "image", id: "image-version-1" } as const;
const audio = { kind: "audio", id: "audio-version-1" } as const;
const composition = (title = "Титр"): CutsceneComposition => ({
  background: { ...image }, title, title_secs: 3, fade_ms: 600,
  layers: [{ id: "layer-1", name: "Метка только для Мастера", image: { ...image }, visible: true,
    position: 0, x_pct: 10, y_pct: 20, w_pct: 40, h_pct: 60 }],
});
const step = (id: string, changes: Partial<CutsceneStep> = {}): CutsceneStep => ({ ...createCutsceneStep(id), ...changes });
const doc = (steps: readonly CutsceneStep[]): CutsceneDocument => ({ ...createCutsceneDocument("Тестовая катсцена"), steps });
const first = (): CutsceneStep => step("a", {
  image: { action: "replace", composition: composition(), transition: createCutsceneVisualTransition() },
  audio: { action: "replace", command: createCutsceneAudioCommand("command-a", audio) },
  text: { action: "replace", text: "Первый фрагмент" }, notes: "Заметка первого шага",
});
const scenario = (): CutsceneDocument => doc([
  first(),
  step("b", { text: { action: "replace", text: "Второй фрагмент" } }),
  step("c", { image: { action: "replace", composition: composition("Другой титр"),
    transition: { kind: "black", durationMs: 800 } }, notes: "Задержаться перед следующей фразой" }),
  step("d", { image: { action: "clear", transition: { kind: "cut", durationMs: 0 } },
    audio: { action: "clear", fadeOutMs: 250 }, text: { action: "clear" }, notes: "Пауза" }),
  step("e"),
  step("f", { audio: { action: "replace", command: createCutsceneAudioCommand("command-f", audio) },
    text: { action: "replace", text: "Первый фрагмент" } }),
]);
const readyMedia: readonly CutsceneMediaCheck[] = [
  { ref: image, status: "ready", durationSeconds: null },
  { ref: audio, status: "ready", durationSeconds: 80 },
];

/** Inject malformed persisted data without weakening production types. */
function changed(path: string, value: unknown): unknown {
  const result = JSON.parse(JSON.stringify(doc([first()]))) as Record<string, unknown>;
  const keys = path.split(".");
  let current = result;
  for (const key of keys.slice(0, -1)) current = current[key] as Record<string, unknown>;
  current[keys[keys.length - 1]] = value;
  return result;
}

describe("cutscene defaults and shared factories", () => {
  it("matches the approved §12 values, including full sound ownership", () => {
    expect(CUTSCENE_DEFAULTS).toEqual({
      visualTransitionKind: "fade", visualTransitionMs: 500,
      audioTransitionMode: "crossfade", audioFadeOutMs: 2000, audioFadeInMs: 2000,
      loopEnabled: false, loopTransitionMode: "crossfade", loopCrossfadeMs: 1000,
      endFadeOutMs: 1000, fontSizePx: 32, wordsPerMinute: 120, audioScope: "all",
      finishImage: "restore", finishAudio: "restore", finishImageTransitionMs: 500,
      finishAudioFadeOutMs: 2000, finishAudioFadeInMs: 2000,
    });
    expect(createCutsceneSettings()).toMatchObject({
      audioScope: "all", wordsPerMinute: 120,
      finish: { image: "restore", audio: "restore", imageTransition: { kind: "fade", durationMs: 500 },
        audioTransition: { mode: "crossfade", fadeOutMs: 2000, fadeInMs: 2000 } },
    });
    expect(createCutsceneAudioCommand("new-command", audio)).toMatchObject({
      startSeconds: 0, endSeconds: null, volume: 1, endFadeOutMs: 1000,
      loop: { enabled: false, transition: { mode: "crossfade", durationMs: 1000 } },
    });
  });

  it("does not share mutable factory settings or accept a caller's media object by reference", () => {
    const one = createCutsceneSettings(), two = createCutsceneSettings();
    Object.assign(one.finish.audioTransition, { fadeInMs: 4 });
    expect(two.finish.audioTransition.fadeInMs).toBe(2000);
    const source = { ...audio };
    const command = createCutsceneAudioCommand("command", source);
    Object.assign(source, { id: "another-audio-version" });
    expect(command.audio).not.toBe(source);
    expect(command.audio.id).toBe("audio-version-1");
    expect(Object.isFrozen(CUTSCENE_DEFAULTS)).toBe(true);
    expect(cutsceneOwnedAudioChannels("music")).toEqual(["background"]);
    expect(cutsceneOwnedAudioChannels("all")).toEqual(["background", "ambient", "weather", "stinger"]);
    expect(Object.isFrozen(cutsceneOwnedAudioChannels("all"))).toBe(true);
  });
});

describe("pure cutscene state resolution", () => {
  it("starts independently in black, without audio/text or inherited GM notes", () => {
    const state = resolveCutsceneStep(doc([step("start")]), "start")!;
    expect(state).toMatchObject({ stepId: "start", stepIndex: 0,
      image: { sourceStepId: null, composition: null, transition: { kind: "fade", durationMs: 500 } },
      audio: { sourceStepId: null, command: null }, text: { sourceStepId: null, text: null }, notes: "" });
    expect(resolveCutsceneStep(doc([]), "missing")).toBeNull();
    expect(resolveCutsceneStep(scenario(), "missing")).toBeNull();
  });

  it("resolves forwards, backwards and direct jumps without history or mutation", () => {
    const document = scenario();
    const before = JSON.stringify(document);
    const b = resolveCutsceneStep(document, "b")!;
    expect(b.image.sourceStepId).toBe("a");
    expect(b.audio.command?.id).toBe("command-a");
    expect(b.text).toEqual({ sourceStepId: "b", text: "Второй фрагмент" });
    expect(b.notes).toBe("");
    const c = resolveCutsceneStep(document, "c")!;
    expect(c.image.sourceStepId).toBe("c");
    expect(c.image.transition).toEqual({ kind: "black", durationMs: 800 });
    expect(c.audio.command?.id).toBe("command-a");
    expect(c.text).toEqual(b.text);
    expect(c.notes).toBe("Задержаться перед следующей фразой");
    resolveCutsceneStep(document, "f");
    expect(resolveCutsceneStep(document, "b")).toEqual(b);
    expect(resolveCutsceneStep(document, "c")).toEqual(c);
    expect(JSON.stringify(document)).toBe(before);
  });

  it("inherits cleared states but never inherits notes", () => {
    const state = resolveCutsceneStep(scenario(), "e")!;
    expect(state.image.composition).toBeNull();
    expect(state.image.sourceStepId).toBe("d");
    expect(state.audio).toEqual({ sourceStepId: "d", command: null, fadeOutMs: 250 });
    expect(state.text).toEqual({ sourceStepId: "d", text: null });
    expect(state.notes).toBe("");
  });

  it("preserves command IDs when reordering and distinguishes a new launch of the same file", () => {
    const original = scenario();
    const reordered = { ...original, steps: [original.steps[1], original.steps[0], ...original.steps.slice(2)] };
    expect(resolveCutsceneStep(reordered, "b")!.audio.command).toBeNull();
    expect(resolveCutsceneStep(reordered, "a")!.audio.command?.id).toBe("command-a");
    expect(resolveCutsceneStep(reordered, "c")!.audio.command?.id).toBe("command-a");
    const a = resolveCutsceneStep(original, "a")!, f = resolveCutsceneStep(original, "f")!;
    expect(f.audio.command?.audio).toEqual(a.audio.command?.audio);
    expect(f.audio.command?.id).not.toBe(a.audio.command?.id);
    expect(f.text.text).toBe(a.text.text);
    expect(f.text.sourceStepId).not.toBe(a.text.sourceStepId);
  });
});

describe("player projection and fixed saved version", () => {
  it("allow-lists nested visual data even if GM objects carry extra private fields", () => {
    const state = resolveCutsceneStep(doc([first()]), "a")!;
    const visual = state.image.composition!;
    const secret = "PRIVATE_READ_ALOUD_AND_RETURN_STATE";
    Object.assign(state, { returnState: secret });
    Object.assign(visual, { notes: secret, narration: secret, audio: secret });
    Object.assign(visual.layers[0], { name: secret, returnState: secret });
    Object.assign(visual.background!, { url: secret });
    Object.assign(state.image.transition, { notes: secret });
    const projected = projectCutscenePlayerFrame(state);
    expect(Object.keys(projected).sort()).toEqual(["composition", "sourceStepId", "stepId", "transition"]);
    expect(projected.composition?.title).toBe("Титр");
    expect(projected.composition?.layers[0]).not.toHaveProperty("name");
    expect(JSON.stringify(projected)).not.toContain(secret);
    expect(JSON.stringify(projected)).not.toContain("Первый фрагмент");
    expect(projected.composition?.background).toEqual(image);
    Object.assign(visual, { title: "Изменили исходник" });
    expect(projected.composition?.title).toBe("Титр");
    expect(projected.composition?.background).not.toBe(visual.background);
    expect(projectCutscenePlayerFrame(resolveCutsceneStep(scenario(), "d")!).composition).toBeNull();
  });

  it("captures a detached, deeply frozen successful save", () => {
    const mutable = JSON.parse(JSON.stringify(doc([first()]))) as Record<string, unknown>;
    const parsed = parseCutsceneDocument(mutable);
    if (!parsed.ok) throw new Error("fixture invalid");
    const result = captureCutsceneVersion({ id: 12, savedVersion: "save-7", document: parsed.value });
    if (!result.ok) throw new Error("snapshot invalid");
    mutable.name = "Другая версия";
    (mutable.steps as Record<string, unknown>[])[0].notes = "Новые заметки";
    expect(result.value.document.name).toBe("Тестовая катсцена");
    expect(result.value.document.steps[0].notes).toBe("Заметка первого шага");
    expect(result.value).toMatchObject({ cutsceneId: 12, savedVersion: "save-7" });
    expect(Object.isFrozen(result.value.document.steps[0].image)).toBe(true);
    expect(Object.isFrozen(result.value.document.steps)).toBe(true);
    expect(captureCutsceneVersion({ id: 0, savedVersion: "", document: parsed.value }).ok).toBe(false);
  });
});

describe("saving a document versus preparing a run", () => {
  it("allows a content-empty draft but not an empty or notes-only run", () => {
    expect(parseCutsceneDocument(createCutsceneDocument("Черновик")).ok).toBe(true);
    expect(checkCutsceneReadiness(createCutsceneDocument("Черновик")).ready).toBe(false);
    expect(checkCutsceneReadiness(doc([step("notes", { notes: "Только заметки" })])).ready).toBe(false);
    expect(checkCutsceneReadiness(doc([step("text", { text: { action: "replace", text: "Читать вслух" } })])).ready).toBe(true);
    expect(checkCutsceneReadiness(doc([step("blank", { text: { action: "replace", text: "  " } })])).ready).toBe(false);
  });

  it("requires fresh checks for all authored files and reports their step IDs", () => {
    const document = doc([first()]);
    const unchecked = checkCutsceneReadiness(document);
    expect(unchecked.ready).toBe(false);
    if (!unchecked.ready) expect(unchecked.issues.every((entry) => entry.code === "media.unchecked" && entry.stepId === "a")).toBe(true);
    expect(checkCutsceneReadiness(document, readyMedia).ready).toBe(true);
    expect(collectCutsceneMediaUses(document).map((use) => use.path)).toEqual([
      "steps.0.image.composition.background", "steps.0.image.composition.layers.0.image", "steps.0.audio.command.audio",
    ]);
    for (const status of ["missing", "pending", "unreadable"] as const) {
      const readiness = checkCutsceneReadiness(document, [{ ...readyMedia[0], status }, readyMedia[1]]);
      if (readiness.ready) throw new Error("bad media accepted");
      expect(readiness.issues).toEqual(expect.arrayContaining([expect.objectContaining({ code: `media.${status}`, stepId: "a" })]));
    }
    expect(checkCutsceneReadiness(document, [...readyMedia, readyMedia[0]]).ready).toBe(false);
  });

  it("checks actual audio duration without inventing arbitrary upper bounds for fades", () => {
    const command = { ...createCutsceneAudioCommand("bounded", audio), startSeconds: 10, endSeconds: 80,
      transition: { mode: "sequential" as const, fadeOutMs: 0, fadeInMs: 100000 } };
    const document = doc([step("audio-only", { audio: { action: "replace", command } })]);
    expect(checkCutsceneReadiness(document, readyMedia).ready).toBe(true);
    for (const durationSeconds of [null, NaN, Infinity, 0, 9, 70]) {
      expect(checkCutsceneReadiness(document, [{ ref: audio, status: "ready", durationSeconds }]).ready).toBe(false);
    }
    expect(checkCutsceneReadiness({ ...document, steps: [step("edge", { audio: {
      action: "replace", command: { ...command, startSeconds: 80, endSeconds: null },
    } })] }, readyMedia).ready).toBe(false);
  });

  it.each([
    ["settings.wordsPerMinute", 0], ["settings.wordsPerMinute", Infinity],
    ["steps.0.audio.command.startSeconds", -1], ["steps.0.audio.command.startSeconds", NaN],
    ["steps.0.audio.command.endSeconds", 0], ["steps.0.audio.command.endSeconds", Infinity],
    ["steps.0.audio.command.volume", 1.1], ["steps.0.audio.command.volume", "0.5"],
    ["steps.0.audio.command.transition.fadeInMs", -1], ["steps.0.audio.command.transition.fadeOutMs", NaN],
    ["steps.0.audio.command.endFadeOutMs", -1], ["steps.0.audio.command.loop.transition.durationMs", Infinity],
    ["steps.0.image.transition.durationMs", -1], ["steps.0.image.composition.title_secs", NaN],
    ["steps.0.image.composition.fade_ms", -1], ["steps.0.image.composition.layers.0.x_pct", NaN],
    ["steps.0.image.composition.layers.0.y_pct", Infinity], ["steps.0.image.composition.layers.0.w_pct", 0],
    ["steps.0.image.composition.layers.0.h_pct", -2], ["steps.0.image.composition.layers.0.position", 0.5],
    ["settings.finish.imageTransition.durationMs", NaN], ["settings.finish.audioTransition.fadeInMs", -1],
    ["steps.0.id", ""], ["steps.0.audio.command.id", "  "], ["name", "  "],
    ["steps.0.audio.command.audio.kind", "image"], ["steps.0.image.composition.background.kind", "audio"],
    ["steps.0.audio.command.audio.url", "/files/temporary?sig=expired"], ["version", 2],
  ])("rejects malformed persisted field %s (%s)", (path, value) => {
    expect(validateCutsceneDocument(changed(path, value)).length).toBeGreaterThan(0);
  });

  it("rejects bad JSON, duplicate identities, reversed fragments and sparse arrays", () => {
    expect(parseCutsceneDocument("{").ok).toBe(false);
    expect(parseCutsceneDocument(JSON.stringify(doc([first()]))).ok).toBe(true);
    expect(validateCutsceneDocument(doc([first(), first()])).map((entry) => entry.code)).toEqual([
      "identity.duplicate-step", "identity.duplicate-command",
    ]);
    const repeatCommand = step("another", { audio: first().audio });
    expect(validateCutsceneDocument(doc([first(), repeatCommand])).some((entry) => entry.code === "identity.duplicate-command")).toBe(true);
    const reversed = changed("steps.0.audio.command.startSeconds", 90);
    const record = reversed as { steps: { audio: { command: Record<string, unknown> } }[] };
    record.steps[0].audio.command.endSeconds = 20;
    expect(validateCutsceneDocument(reversed).some((entry) => entry.code === "fragment.order")).toBe(true);
    expect(parseCutsceneDocument({ ...doc([]), steps: new Array(1) }).ok).toBe(false);
    expect(parseCutsceneDocument(new Date()).ok).toBe(false);
    const twoLayers = composition();
    expect(validateCutsceneDocument(doc([step("layers", { image: { action: "replace",
      composition: { ...twoLayers, layers: [...twoLayers.layers, ...twoLayers.layers] },
      transition: createCutsceneVisualTransition() } })])).some((entry) => entry.code === "identity.duplicate-layer")).toBe(true);
  });

  it("accepts all approved loop and transition variants, including zero durations", () => {
    for (const transition of [{ mode: "cut" }, { mode: "crossfade", durationMs: 0 },
      { mode: "sequential", fadeOutMs: 0, fadeInMs: 250 }] as const) {
      const command = { ...createCutsceneAudioCommand("loop", audio), loop: { enabled: true, transition } };
      expect(checkCutsceneReadiness(doc([step("loop-step", { audio: { action: "replace", command } })]), readyMedia).ready).toBe(true);
    }
    const clearOnly = doc([step("clear", { image: { action: "clear", transition: { kind: "black", durationMs: 0 } },
      audio: { action: "clear", fadeOutMs: 0 }, text: { action: "clear" } })]);
    expect(parseCutsceneDocument(clearOnly).ok).toBe(true);
    expect(checkCutsceneReadiness(clearOnly).ready).toBe(false);
  });
});

describe("step names and labels", () => {
  const composition = (title: string): CutsceneComposition => ({ background: image, layers: [], title, title_secs: 3, fade_ms: 0 });
  it("labels a step by name, then own caption, then own text, then number", () => {
    const base = createCutsceneStep("s");
    expect(cutsceneStepLabel({ ...base, name: "  Берез " }, 0)).toBe("Берез");
    const captioned: CutsceneStep = { ...base, image: { action: "replace", composition: composition("Ночь у костра"), transition: createCutsceneVisualTransition() } };
    expect(cutsceneStepLabel(captioned, 1)).toBe("Ночь у костра");
    expect(cutsceneStepLabel({ ...base, text: { action: "replace", text: "**Дорога** вьётся между берёз, колея давно пуста" } }, 2)).toBe("Дорога вьётся между берёз, колея…");
    expect(cutsceneStepLabel({ ...base, text: { action: "replace", text: "Тишина." } }, 2)).toBe("Тишина.");
    expect(cutsceneStepLabel(base, 4)).toBe("Шаг 5");
  });
  it("keeps documents without names valid and rejects a non-string name", () => {
    const document = createCutsceneDocument("Имена");
    const named = { ...document, steps: [{ ...createCutsceneStep("a"), name: "Пролог" }, createCutsceneStep("b")] };
    expect(validateCutsceneDocument(named)).toEqual([]);
    expect(validateCutsceneDocument({ ...document, steps: [{ ...createCutsceneStep("a"), name: 5 }] }).map(issue => issue.path)).toEqual(["steps.0.name"]);
  });
  it("starts a step name from an image file name", () => {
    expect(cutsceneStepNameFromFile("04_Witch_hut.png")).toBe("Witch hut");
    expect(cutsceneStepNameFromFile("Ravenloft.jpeg")).toBe("Ravenloft");
    expect(cutsceneStepNameFromFile("07 - Туманы.webp")).toBe("Туманы");
  });
});
