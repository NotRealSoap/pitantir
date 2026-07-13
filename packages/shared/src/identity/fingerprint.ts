import { createHash } from "node:crypto";
import type { BookMetadata } from "./types.js";

export const FINGERPRINT_SPEC_VERSION = "v1";

export function normalizeText(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ");
}

export function normalizePageText(value: string): string {
  return value.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

export function hashContent(parts: string[]): string {
  return createHash("sha256").update(parts.join("\n"), "utf8").digest("hex");
}

export function computeStrictFingerprint(
  metadata: BookMetadata,
  nonce?: string | null,
): string {
  const digest = hashContent([
    FINGERPRINT_SPEC_VERSION,
    "strict",
    normalizeText(metadata.title ?? ""),
    normalizeText(metadata.author ?? ""),
    metadata.pageContentHash ?? "",
    metadata.generation ?? "",
    nonce ?? "",
  ]);
  return `${FINGERPRINT_SPEC_VERSION}:strict:${digest}`;
}

export function computeLooseFingerprint(metadata: BookMetadata): string {
  const digest = hashContent([
    FINGERPRINT_SPEC_VERSION,
    "loose",
    normalizeText(metadata.title ?? ""),
    normalizeText(metadata.author ?? ""),
    String(metadata.pageCount ?? 0),
  ]);
  return `${FINGERPRINT_SPEC_VERSION}:loose:${digest}`;
}

export function fingerprintFromRawItem(rawItem: Record<string, unknown>): {
  metadata: BookMetadata;
  nonce: string | null;
  strictFingerprint: string;
  looseFingerprint: string;
} {
  const title = typeof rawItem.title === "string" ? rawItem.title : null;
  const author = typeof rawItem.author === "string" ? rawItem.author : null;
  const pageCount = typeof rawItem.pageCount === "number" ? rawItem.pageCount : null;
  const pages = typeof rawItem.pages === "string" ? rawItem.pages : null;
  const generation = typeof rawItem.generation === "string" ? rawItem.generation : null;
  const nonce = typeof rawItem.nonce === "string" ? rawItem.nonce : null;

  const pageContentHash = pages
    ? hashContent([normalizePageText(pages)])
    : null;

  const metadata: BookMetadata = {
    title,
    author,
    pageCount,
    pageContentHash,
    generation,
  };

  return {
    metadata,
    nonce,
    strictFingerprint: computeStrictFingerprint(metadata, nonce),
    looseFingerprint: computeLooseFingerprint(metadata),
  };
}
