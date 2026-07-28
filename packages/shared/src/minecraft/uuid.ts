export function formatUndashedUuid(undashed: string): string {
  const hex = undashed.replace(/-/g, "").toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(hex)) {
    throw new Error(`Invalid UUID hex: ${undashed}`);
  }
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function normalizeUuid(value: string): string {
  return formatUndashedUuid(value);
}
