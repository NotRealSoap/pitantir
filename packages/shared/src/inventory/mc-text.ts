/** Minecraft §-formatting helpers — safe for Next.js (no Node builtins). */

export function stripMcFormatting(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  return value.replace(/§./g, "").trim() || null;
}
