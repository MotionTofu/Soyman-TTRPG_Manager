export type WorkspaceMode = "standard" | "session" | "maps";

/** URL — источник режима; просмотр игрока остаётся в обычной оболочке. */
export function workspaceMode(pathname: string, role?: string): WorkspaceMode {
  if (role !== "gm") return "standard";
  if (/^\/maps(?:\/\d+(?:\/workspace)?)?\/?$/.test(pathname)) return "maps";
  if (/^\/sessions\/\d+\/live\/?$/.test(pathname)) return "session";
  return "standard";
}
