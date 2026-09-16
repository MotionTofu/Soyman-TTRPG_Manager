import fs from "fs";
import path from "path";

function within(root: string, target: string, allowRoot: boolean): boolean {
  const relative = path.relative(root, target);
  return relative === "" ? allowRoot : relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

// Resolve existing ancestors too: a future upload can sit inside a junction.
function physicalPath(target: string): string {
  try { return fs.realpathSync(target); } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    try {
      if (fs.lstatSync(target).isSymbolicLink()) throw new Error("Dangling filesystem link");
    } catch (statError) {
      if ((statError as NodeJS.ErrnoException).code !== "ENOENT") throw statError;
    }
    const parent = path.dirname(target);
    if (parent === target) throw error;
    return path.join(physicalPath(parent), path.basename(target));
  }
}

export function assertPathInside(root: string, target: string, allowRoot = false): string {
  if (target.includes("\0")) throw new Error("Invalid filesystem path");
  const base = path.resolve(root);
  const resolved = path.resolve(target);
  if (process.platform === "win32" && path.relative(base, resolved).split(path.sep).some(segment =>
    /[<>:"|?*]/.test(segment) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(segment) || /[ .]$/.test(segment))) {
    throw new Error("Invalid Windows filesystem path");
  }
  if (!within(base, resolved, allowRoot) || !within(fs.realpathSync(base), physicalPath(resolved), allowRoot)) {
    throw new Error("Path outside allowed directory");
  }
  return resolved;
}
