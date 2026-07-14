import { z } from "zod";
import {
  DECISION_TYPES,
  IDENTIFIER_KINDS,
  ITEM_CATEGORIES,
  RESOLUTION_STATUSES,
} from "./enums.js";

export const bookMetadataSchema = z.object({
  title: z.string().nullable().optional(),
  author: z.string().nullable().optional(),
  pageCount: z.number().int().nonnegative().nullable().optional(),
  pageContentHash: z.string().nullable().optional(),
  generation: z.string().nullable().optional(),
});

export const manualResolveInputSchema = z.object({
  observationId: z.string().uuid(),
  itemId: z.string().uuid().optional(),
  createNewItem: z.boolean().optional(),
  actor: z.string().min(1),
  rationale: z.string().min(1),
  idempotencyKey: z.string().min(1).optional(),
});

export const mergeItemsInputSchema = z.object({
  survivorItemId: z.string().uuid(),
  loserItemId: z.string().uuid(),
  actor: z.string().min(1),
  rationale: z.string().min(1),
  idempotencyKey: z.string().min(1).optional(),
});

export const splitItemInputSchema = z.object({
  sourceItemId: z.string().uuid(),
  actor: z.string().min(1),
  rationale: z.string().min(1),
  assignments: z
    .array(
      z.object({
        targetItemId: z.string().uuid().optional(),
        createNewItem: z.boolean().optional(),
        observationIds: z.array(z.string().uuid()).min(1),
        displayName: z.string().optional(),
      }),
    )
    .min(2),
  idempotencyKey: z.string().min(1).optional(),
});

export const revertDecisionInputSchema = z.object({
  decisionId: z.string().uuid(),
  actor: z.string().min(1),
  rationale: z.string().min(1),
  idempotencyKey: z.string().min(1).optional(),
});

export const addIdentifierInputSchema = z.object({
  itemId: z.string().uuid(),
  kind: z.enum(IDENTIFIER_KINDS),
  value: z.string().min(1),
  source: z.string().min(1).nullable().optional(),
  confidence: z.enum(["high", "medium", "low"]).default("medium"),
});

export const itemCategorySchema = z.enum(ITEM_CATEGORIES);
export const resolutionStatusSchema = z.enum(RESOLUTION_STATUSES);
export const decisionTypeSchema = z.enum(DECISION_TYPES);
