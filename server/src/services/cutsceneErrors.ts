export class CutsceneRequestError extends Error {
  constructor(readonly status: number, message: string, readonly issues?: unknown) { super(message); }
}
