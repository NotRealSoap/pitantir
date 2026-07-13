import { z } from "zod";
import { ITEM_SEARCH_KINDS } from "./types.js";

const MINECRAFT_USERNAME = /^[A-Za-z0-9_]{3,16}$/;
const NONCE_VALUE = /^[A-Za-z0-9._:-]{1,128}$/;

export const itemSearchRequestSchema = z.object({
  kind: z.enum(ITEM_SEARCH_KINDS),
  value: z.string().trim().min(1).max(128),
  page: z.number().int().min(0).max(100).default(0),
});

export type ItemSearchRequest = z.infer<typeof itemSearchRequestSchema>;

export function domainSearchQueryLabel(input: {
  kind: ItemSearchRequest["kind"];
  value: string;
}): string {
  return `${input.kind}:${input.value}`;
}

export function validateSearchValue(kind: ItemSearchRequest["kind"], value: string): string {
  const trimmed = value.trim();
  if (kind === "exact_nonce") {
    if (!NONCE_VALUE.test(trimmed)) {
      throw new Error("Invalid nonce format");
    }
    return trimmed;
  }

  if (!MINECRAFT_USERNAME.test(trimmed)) {
    throw new Error("Invalid Minecraft username");
  }
  return trimmed;
}

export const itemSearchResponseSchema = z.object({
  status: z.enum([
    "ok",
    "no_results",
    "invalid_search",
    "unsupported_search",
    "upstream_unavailable",
    "rate_limited",
  ]),
  page: z.number().int(),
  hasNextPage: z.boolean(),
  items: z.array(
    z.object({
      providerItemKey: z.string(),
      source: z.string(),
      observedAt: z.string().nullable(),
      resolutionStatus: z.string(),
      canonicalItemId: z.string().nullable(),
      rawPayload: z.record(z.string(), z.unknown()),
    }),
  ),
  message: z.string().optional(),
});

export type ItemSearchResponse = z.infer<typeof itemSearchResponseSchema>;
