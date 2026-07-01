/** Tiny class-name joiner. Filters falsy values; no external dependency. */
export type ClassValue = string | false | null | undefined;

export function cn(...values: ClassValue[]): string {
  return values.filter(Boolean).join(' ');
}
