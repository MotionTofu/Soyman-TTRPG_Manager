import { z } from "zod";
import { createCutsceneDocument, createCutsceneStep, parseCutsceneDocument, type CutsceneAudioCommand } from "@soyman/shared";
import { CutsceneRequestError } from "./cutsceneErrors";

const key = z.string().trim().min(1).max(200);
const id = z.number().int().positive().safe();
const gain = z.number().finite().min(0).max(1);
const seconds = z.number().finite().nonnegative();
const audioRef = z.object({ kind: z.literal("audio"), id: key });
const mediaRef = z.object({ kind: z.enum(["image", "audio"]), id: key });
const source = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("resource"), resourceId: id }),
  z.object({ kind: z.literal("cutscene"), audio: audioRef }),
]);
const transport = z.enum(["playing", "paused", "stopped"]);
const queue = z.object({ kind: z.literal("queue"), queue: z.array(z.object({ source, name: z.string() })),
  index: z.number().int().nonnegative().nullable(), positionSeconds: seconds, state: transport,
  volume: gain, repeat: z.enum(["off", "track", "playlist"]), shuffle: z.boolean(), activePlaylistId: id.nullable(),
}).superRefine((value, ctx) => {
  if ((value.index !== null && value.index >= value.queue.length) || (value.state !== "stopped" && value.index === null)) {
    ctx.addIssue({ code: "custom", message: "Некорректный индекс очереди" });
  }
});
const command = z.unknown().transform((raw, ctx): CutsceneAudioCommand => {
  const parsed = parseCutsceneDocument({ ...createCutsceneDocument("Снимок"), steps: [
    { ...createCutsceneStep("snapshot"), audio: { action: "replace", command: raw } },
  ] });
  if (!parsed.ok || parsed.value.steps[0].audio.action !== "replace") {
    ctx.addIssue({ code: "custom", message: "Некорректная музыкальная команда" }); return z.NEVER;
  }
  return parsed.value.steps[0].audio.command;
});
export const retainedMusicInput = z.object({ kind: z.literal("cutscene"), cutsceneId: id, runId: key,
  command, positionSeconds: seconds, state: transport, volume: gain });
const background = z.union([queue, retainedMusicInput]);
const loop = z.object({ source: source.nullable(), positionSeconds: seconds, state: transport }).superRefine((value, ctx) => {
  if (value.source === null && value.state !== "stopped") ctx.addIssue({ code: "custom", message: "Не выбран источник слоя" });
});
const automation = z.object({ combat: z.object({ from: z.string(), to: z.string(), previous: queue }).nullable(),
  sceneSet: z.object({ scene: z.string(), to: z.string(), previousSetId: id.nullable() }).nullable().optional() }).optional();
export const returnAudioInput = z.discriminatedUnion("scope", [
  z.object({ scope: z.literal("music"), background, automation }),
  z.object({ scope: z.literal("all"), background, ambient: loop, weather: loop, setId: id.nullable(), duckingId: id.nullable(),
    silence: z.boolean(), volumes: z.object({ master: gain, background: gain, ambient: gain, weather: gain, stinger: gain }), automation }),
]);
const context = z.discriminatedUnion("kind", [z.object({ kind: z.literal("library") }),
  z.object({ kind: z.literal("campaign"), campaignId: id }),
  z.object({ kind: z.literal("session"), sessionId: id, campaignId: id.nullable() })]);
export const runOwnerInput = z.object({ runId: key, controllerId: key });
export const revisionInput = z.number().int().positive().safe();
export const startRunInput = z.object({ cutsceneId: id, controllerId: key, mode: z.enum(["live", "rehearsal"]), context,
  returnState: z.object({ audio: returnAudioInput, window: z.object({ wasOpen: z.boolean(), openedByRun: z.boolean(), screenId: key.nullable(), windowId: key.nullable().optional() }) }),
});
export const checkpointInput = z.object({ runId: key, stepId: key.nullable(), pendingStepId: key.nullable(),
  phase: z.enum(["ready", "preparing", "playing", "paused", "error"]), textPaused: z.boolean(),
  error: z.object({ code: z.enum(["media", "display", "audio", "storage", "preparation"]), message: z.string(),
    stepId: key.nullable(), media: mediaRef.nullable() }).nullable(),
}).strict();
export const updateRunInput = z.object({ owner: runOwnerInput, revision: revisionInput, checkpoint: checkpointInput }).strict();
export const recoverRunInput = z.object({ controllerId: key, revision: revisionInput }).strict();
export const finishRunInput = z.object({ owner: runOwnerInput, revision: revisionInput, kind: z.enum(["complete", "interrupt"]),
  music: retainedMusicInput.nullable().optional() }).strict();
export const releaseMusicInput = z.object({ runId: key, revision: z.number().int().nonnegative().safe() }).strict();

export function runInput<T extends z.ZodType>(schema: T, raw: unknown): z.output<T> {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw new CutsceneRequestError(400, parsed.error.issues.map(issue => issue.message).join("; "));
  return parsed.data;
}
