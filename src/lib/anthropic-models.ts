/**
 * Central Anthropic model selection.
 *
 * Claude Sonnet 4 (`claude-sonnet-4-20250514`) was retired on the
 * Anthropic API on 2026-06-15. Keeping the default here prevents one
 * stale constant from silently pushing AI features into fallback paths.
 */

export const DEFAULT_ANTHROPIC_SONNET_MODEL = "claude-sonnet-4-6";

export function getAnthropicSonnetModel(): string {
  return (
    process.env.ANTHROPIC_SONNET_MODEL?.trim() ||
    process.env.ANTHROPIC_MODEL?.trim() ||
    DEFAULT_ANTHROPIC_SONNET_MODEL
  );
}
