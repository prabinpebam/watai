import { z } from 'zod';
import { containsSecretLikeValue } from './secrets';
import { parseOrThrow } from './validate';

export const MEMORY_ROUTE_LAYERS = [
  'working',
  'today',
  'week',
  'month',
  'long_term_profile',
  'project',
  'evidence_archive',
] as const;

export const MEMORY_PROFILE_PATHS = [
  'user.details.name',
  'user.details.location',
  'user.family.spouse',
  'user.family.children',
  'user.family.pets',
  'user.preferences.communication',
  'user.preferences.engineering',
  'user.preferences.design',
  'user.preferences.tools',
  'user.preferences.other',
  'user.interests.media',
  'user.interests.hobbies',
  'user.interests.other',
  'work.projects',
  'work.repositories',
  'work.deployments',
  'work.currentFocus',
  'avoidances',
  'custom',
] as const;

export const MEMORY_ENTITY_TYPES = [
  'user',
  'person',
  'family_member',
  'pet',
  'project',
  'repo',
  'tool',
  'organization',
  'location',
  'interest',
  'concept',
  'custom',
] as const;

export const MEMORY_RELATIONSHIP_PREDICATES = [
  'HAS_FAMILY_MEMBER',
  'HAS_PET',
  'HAS_ATTRIBUTE',
  'PREFERS',
  'AVOIDS',
  'WORKS_ON',
  'USES_TOOL',
  'DEPLOYS_TO',
  'INTERESTED_IN',
  'INSPIRED_BY',
  'CUSTOM',
] as const;

const id = z.string().trim().min(1).max(64);
const iso = z.string().trim().min(1).max(40);
const label = z.string().trim().min(1).max(120).refine((value) => !containsSecretLikeValue(value), { message: 'Memory route label cannot contain secret-like values.' });
const text = z.string().trim().min(1).max(2000).refine((value) => !containsSecretLikeValue(value), { message: 'Memory route text cannot contain secret-like values.' });
const score = z.number().min(0).max(1);
const scalar = z.union([z.string().trim().max(500), z.number(), z.boolean(), z.null()]);

export const memoryEntityRefSchema = z
  .object({
    id: id.optional(),
    type: z.enum(MEMORY_ENTITY_TYPES),
    name: label,
    aliases: z.array(label).max(12).optional(),
  })
  .strict();

export const memoryRelationshipTargetSchema = z
  .object({
    predicate: z.enum(MEMORY_RELATIONSHIP_PREDICATES),
    subject: memoryEntityRefSchema.optional(),
    object: memoryEntityRefSchema.optional(),
    objectValue: text.optional(),
    attributes: z.record(scalar).optional(),
    customPredicate: label.optional(),
  })
  .strict()
  .superRefine((relationship, ctx) => {
    if (!relationship.object && !relationship.objectValue && !relationship.attributes) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['object'], message: 'Relationship target requires object, objectValue, or attributes.' });
    }
    if (relationship.predicate === 'CUSTOM' && !relationship.customPredicate) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['customPredicate'], message: 'customPredicate is required for CUSTOM relationships.' });
    }
  });

export const memoryRouteTargetSchema = z
  .object({
    layer: z.enum(MEMORY_ROUTE_LAYERS),
    profilePath: z.enum(MEMORY_PROFILE_PATHS).optional(),
    customPath: label.optional(),
    entity: memoryEntityRefSchema.optional(),
    relationship: memoryRelationshipTargetSchema.optional(),
    temporal: z
      .object({
        bucket: z.enum(['today', 'week', 'month', 'long_term']),
        validAt: iso.optional(),
        invalidAt: iso.optional(),
        expiresAt: iso.optional(),
      })
      .strict()
      .optional(),
    evidenceStrategy: z.enum(['append', 'merge', 'invalidate_then_add']).optional(),
  })
  .strict()
  .superRefine((target, ctx) => {
    if (target.layer === 'long_term_profile' && !target.profilePath) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['profilePath'], message: 'long_term_profile targets require a profilePath.' });
    }
    if (target.profilePath === 'custom' && !target.customPath) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['customPath'], message: 'custom profile paths require customPath.' });
    }
    if (target.layer !== 'evidence_archive' && !target.profilePath && !target.entity && !target.relationship) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['profilePath'], message: 'Memory route target must specify a profile path, entity, or relationship.' });
    }
  });

export const memoryWritePlanSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('ignore'), reason: text }).strict(),
  z
    .object({
      op: z.literal('store'),
      canonicalText: text,
      target: memoryRouteTargetSchema,
      confidence: score,
      salience: score,
      sourceMessageIds: z.array(id).min(1).max(12),
      reason: text,
    })
    .strict(),
  z
    .object({
      op: z.literal('merge'),
      memoryId: id,
      canonicalText: text.optional(),
      target: memoryRouteTargetSchema.optional(),
      confidence: score.optional(),
      salience: score.optional(),
      sourceMessageIds: z.array(id).min(1).max(12),
      reason: text,
    })
    .strict(),
  z.object({ op: z.literal('invalidate'), memoryId: id, sourceMessageIds: z.array(id).min(1).max(12), reason: text }).strict(),
  z.object({ op: z.literal('suppress'), memoryId: id, sourceMessageIds: z.array(id).min(1).max(12), reason: text }).strict(),
]);

export type MemoryRouteLayer = z.infer<typeof memoryRouteTargetSchema>['layer'];
export type MemoryProfilePath = z.infer<typeof memoryRouteTargetSchema>['profilePath'];
export type MemoryEntityRef = z.infer<typeof memoryEntityRefSchema>;
export type MemoryRelationshipTarget = z.infer<typeof memoryRelationshipTargetSchema>;
export type MemoryRouteTarget = z.infer<typeof memoryRouteTargetSchema>;
export type MemoryWritePlan = z.infer<typeof memoryWritePlanSchema>;

export function parseMemoryRouteTarget(input: unknown): MemoryRouteTarget {
  return parseOrThrow(memoryRouteTargetSchema, input, 'Invalid memory route target.');
}

export function parseMemoryWritePlan(input: unknown): MemoryWritePlan {
  return parseOrThrow(memoryWritePlanSchema, input, 'Invalid memory write plan.');
}