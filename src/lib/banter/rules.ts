export const INTERESTS = [
  "Gaming",
  "Music",
  "Technology",
  "Programming",
  "Photography",
  "Movies",
  "Sports",
  "Travel",
  "Art",
  "Books",
  "Education",
  "Fitness",
  "Entertainment",
] as const;

export type Interest = (typeof INTERESTS)[number];

const RESERVED = new Set([
  "admin",
  "banter",
  "support",
  "help",
  "everyone",
  "system",
  "moderator",
]);

export function cleanUsername(raw: string): string | null {
  const u = raw.trim().toLowerCase().replace(/^@/, "");
  if (!/^[a-z][a-z0-9_]{2,19}$/.test(u)) return null;
  if (RESERVED.has(u)) return null;
  return u;
}

export function cleanDisplayName(raw: string): string | null {
  const n = raw.trim().replace(/\s+/g, " ");
  if (n.length < 1 || n.length > 40) return null;
  if ([...n].some((char) => char.charCodeAt(0) <= 31)) return null;
  return n;
}

export function cleanInterests(raw: string[]): string[] {
  const allowed = new Set<string>(INTERESTS);
  const out: string[] = [];
  for (const item of raw) {
    if (allowed.has(item) && !out.includes(item)) out.push(item);
    if (out.length >= 8) break;
  }
  return out;
}

export function snippet(text: string, max = 80): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

export const REACTIONS = ["♥", "☺", "!", "…", "✦", "↑"] as const;

export const WALLPAPERS = ["ink", "paper", "clay", "sage", "dusk"] as const;

export const STORY_BACKGROUNDS = ["clay", "ink", "sage", "dusk", "apricot"] as const;
