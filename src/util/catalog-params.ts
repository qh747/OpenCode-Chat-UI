/**
 * Query helpers for opencode v2 catalog endpoints. Verified live on 2.3.0:
 * location-scoped endpoints (/api/agent, /api/skill, …) require the
 * deepObject form `?location[directory]=…`; the plain `?directory=` form
 * returns empty lists, and /api/command expects NO parameter at all.
 */
export function locationQuery(directory: string): string {
  return `location%5Bdirectory%5D=${encodeURIComponent(directory)}`;
}
