import { z } from "zod";

export const LEGAL_DOCUMENT_IDS = ["conditions", "confidentialite"] as const;
export const LegalDocumentIdSchema = z.enum(LEGAL_DOCUMENT_IDS);

export const LegalDocumentDraftSchema = z.object({
  title: z.string().trim().min(4).max(120),
  body: z.string().trim().min(80).max(30_000),
}).strict();

export type LegalDocumentId = (typeof LEGAL_DOCUMENT_IDS)[number];
export type LegalDocumentDraft = z.infer<typeof LegalDocumentDraftSchema>;

export function isLegalDocumentId(value: string): value is LegalDocumentId {
  return LegalDocumentIdSchema.safeParse(value).success;
}

export function serializeLegalTimestamp(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const timestamp = value as { toDate?: () => Date };
  if (typeof timestamp.toDate !== "function") return null;
  const date = timestamp.toDate();
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function serializeVersion(value: unknown) {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (
    typeof record.title !== "string" ||
    typeof record.body !== "string" ||
    typeof record.version !== "number" ||
    !Number.isSafeInteger(record.version) ||
    record.version < 1
  ) return null;
  const publishedAt = serializeLegalTimestamp(record.publishedAt);
  if (!publishedAt) return null;
  return {
    title: record.title,
    body: record.body,
    version: record.version,
    publishedAt,
  };
}

export function serializeLegalDocument(value: Record<string, unknown>) {
  const draft = value.draft && typeof value.draft === "object"
    ? value.draft as Record<string, unknown>
    : null;
  return {
    draft: draft && typeof draft.title === "string" && typeof draft.body === "string"
      ? {
        title: draft.title,
        body: draft.body,
        updatedAt: serializeLegalTimestamp(draft.updatedAt),
      }
      : null,
    published: serializeVersion(value.published),
  };
}

export function hasPublishedLegalDocument(value: Record<string, unknown> | undefined): boolean {
  return Boolean(value && serializeVersion(value.published));
}
