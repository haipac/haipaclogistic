import { z } from "zod";

export const ADMIN_POLICY_IDS = ["data-retention", "operations", "payments"] as const;
export const AdminPolicyIdSchema = z.enum(ADMIN_POLICY_IDS);

export const AdminPolicyDraftSchema = z.object({
  title: z.string().trim().min(4).max(120),
  body: z.string().trim().min(80).max(30_000),
}).strict();

export type AdminPolicyId = (typeof ADMIN_POLICY_IDS)[number];

export function isAdminPolicyId(value: string): value is AdminPolicyId {
  return AdminPolicyIdSchema.safeParse(value).success;
}

function serializeTimestamp(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const timestamp = value as { toDate?: () => Date };
  if (typeof timestamp.toDate !== "function") return null;
  const date = timestamp.toDate();
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function serializePublished(value: unknown) {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const content = AdminPolicyDraftSchema.safeParse({ title: record.title, body: record.body });
  if (!content.success || typeof record.version !== "number" || !Number.isSafeInteger(record.version) || record.version < 1) return null;
  const publishedAt = serializeTimestamp(record.publishedAt);
  if (!publishedAt) return null;
  return { ...content.data, version: record.version, publishedAt };
}

export function serializeAdminPolicy(value: Record<string, unknown>) {
  const candidate = value.draft && typeof value.draft === "object"
    ? value.draft as Record<string, unknown>
    : null;
  const draft = candidate
    ? AdminPolicyDraftSchema.safeParse({ title: candidate.title, body: candidate.body })
    : null;
  return {
    draft: draft?.success
      ? { ...draft.data, updatedAt: serializeTimestamp(candidate?.updatedAt) }
      : null,
    published: serializePublished(value.published),
  };
}

export function hasPublishedAdminPolicy(value: Record<string, unknown> | undefined): boolean {
  return Boolean(value && serializePublished(value.published));
}
