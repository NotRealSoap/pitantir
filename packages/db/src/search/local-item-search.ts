import type { ItemSearchKind } from "@pitantir/shared/item-data";

export interface LocalItemSearchQuery {
  nonce?: string | undefined;
  strictFingerprint?: string | undefined;
  displayName?: string | undefined;
  limit?: number | undefined;
}

export interface LocalItemSearchResult {
  itemId: string;
  displayName: string | null;
  primaryNonce: string | null;
  identityConfidence: string;
}

/** Searches Pitantir's own indexed canonical items — never calls upstream providers. */
export interface LocalItemSearchRepository {
  search(query: LocalItemSearchQuery): Promise<LocalItemSearchResult[]>;
  supports(kind: ItemSearchKind): boolean;
}

export class UnimplementedLocalItemSearchRepository implements LocalItemSearchRepository {
  supports(): boolean {
    return false;
  }

  async search(): Promise<LocalItemSearchResult[]> {
    return [];
  }
}
