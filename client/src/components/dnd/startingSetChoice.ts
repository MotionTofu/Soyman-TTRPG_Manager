// One alternative per source, including legacy drafts with both options checked.
export function selectedStartingSet<T extends { label: string }>(sets: T[], saved: Record<string, boolean>): T | undefined {
  return sets.find(s => saved[s.label] === true) ?? sets[0];
}
