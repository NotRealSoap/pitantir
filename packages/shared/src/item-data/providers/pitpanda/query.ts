import type { ItemSearchInput } from "../../types.js";

export function buildPitPandaSearchQuery(input: Pick<ItemSearchInput, "kind" | "value">): string {
  switch (input.kind) {
    case "exact_nonce":
      return `nonce${input.value}`;
    case "current_owner":
      return `uuid${input.value}`;
    case "past_owner":
      return `past${input.value}`;
    default: {
      const _exhaustive: never = input.kind;
      return _exhaustive;
    }
  }
}
