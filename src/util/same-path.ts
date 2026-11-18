/** Path comparison shared by the event filter and the branch context:
 *  separators unify, trailing slashes drop, case folds (drive-letter
 *  safe on Windows-style paths). The git module keeps its own stricter
 *  normalizer for workspace matching — folding the whole path there would
 *  collide legitimately distinct case-sensitive roots. */
export function normalizePath(value: string): string {
  return value.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

/** True when two paths name the same directory. */
export function samePath(a: string, b: string): boolean {
  return normalizePath(a) === normalizePath(b);
}
