/** Parse "v1.2.3" / "1.2.3" into [1,2,3]. Missing or non-numeric parts count as 0. */
export function parseVersion(v: string): number[] {
  return v
    .trim()
    .replace(/^v/i, "")
    .split("-")[0]
    .split(".")
    .map((p) => parseInt(p, 10) || 0);
}

/** True when `candidate` is strictly newer than `current`. */
export function isNewerVersion(candidate: string, current: string): boolean {
  const a = parseVersion(candidate);
  const b = parseVersion(current);
  const len = Math.max(a.length, b.length, 3);
  for (let i = 0; i < len; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x > y) return true;
    if (x < y) return false;
  }
  return false;
}
