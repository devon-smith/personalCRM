/**
 * Hash-based avatar color assignment.
 * Each contact gets a consistent, deterministic color based on their name.
 *
 * The palette uses a single warm-neutral hue family at low saturation so a
 * list of avatars reads as a set rather than a circus. Pure neutral
 * (no-letters / phone-only / email-only) names get a distinct stone tone
 * so they still feel handled rather than broken.
 */

const AVATAR_PALETTES = [
  { bg: "#E0DBCC", text: "#5A574F" }, // linen
  { bg: "#DCDCC9", text: "#56583F" }, // olive
  { bg: "#DDE3E3", text: "#43504F" }, // stone
  { bg: "#E8E4DC", text: "#5A574F" }, // mist
  { bg: "#EFEAE0", text: "#5A574F" }, // sand-raised
  { bg: "#D6D9CC", text: "#4D5544" }, // moss-quiet
  { bg: "#D6CFC2", text: "#5A4F3D" }, // dune
  { bg: "#CFD7D2", text: "#3F4F47" }, // sage-fog
] as const;

const NEUTRAL_PALETTE = { bg: "#DDE3E3", text: "#5A574F" };

function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0; // Convert to 32-bit integer
  }
  return Math.abs(hash);
}

/**
 * Strip everything that isn't a letter. Numbers, symbols, leading
 * punctuation, surrounding quotes all go. Returns "" if nothing's
 * left.
 */
function lettersOnly(input: string): string {
  return input.replace(/[^\p{L}\s]/gu, "").trim();
}

export function getAvatarColor(name: string): { bg: string; text: string } {
  const cleaned = lettersOnly(name);
  if (!cleaned) return NEUTRAL_PALETTE;
  const index = hashString(cleaned) % AVATAR_PALETTES.length;
  return AVATAR_PALETTES[index];
}

/**
 * Initials from the first two whole letter-tokens. Numbers / symbols
 * are ignored. Falls back to "·" so phone- or email-only contacts get
 * a glyph rather than a confusing alphanumeric initial.
 */
export function getInitials(name: string): string {
  const cleaned = lettersOnly(name);
  if (!cleaned) return "·";
  const tokens = cleaned.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return "·";
  return tokens
    .slice(0, 2)
    .map((t) => t[0]!)
    .join("")
    .toUpperCase();
}
