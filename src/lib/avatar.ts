/**
 * Hash-based avatar color assignment.
 * Each contact gets a consistent, deterministic color based on their name.
 */

const AVATAR_PALETTES = [
  { bg: "#dbeafe", text: "#1e40af" }, // blue
  { bg: "#f3e8ff", text: "#6b21a8" }, // purple
  { bg: "#dcfce7", text: "#166534" }, // green
  { bg: "#fef3c7", text: "#92400e" }, // amber
  { bg: "#ffe4e6", text: "#9f1239" }, // rose
  { bg: "#e0e7ff", text: "#3730a3" }, // indigo
  { bg: "#ccfbf1", text: "#115e59" }, // teal
  { bg: "#fce7f3", text: "#9d174d" }, // pink
] as const;

function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0; // Convert to 32-bit integer
  }
  return Math.abs(hash);
}

export function getAvatarColor(name: string): { bg: string; text: string } {
  const index = hashString(name) % AVATAR_PALETTES.length;
  return AVATAR_PALETTES[index];
}

export function getInitials(name: string): string {
  return name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}
