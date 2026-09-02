type Preview = { type: string; id: number } | null;

let current: Preview = null;
const listeners = new Set<() => void>();

function notify() {
  for (const fn of listeners) fn();
}

export function openMentionPreview(type: string, id: number) {
  current = { type, id };
  notify();
}

export function closeMentionPreview() {
  current = null;
  notify();
}

export function getMentionPreview(): Preview {
  return current;
}

export function subscribeMentionPreview(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
