import { z } from 'zod'

import {
    CLUB_IMPORT_FIELD_KEYS,
    CLUB_IMPORT_FIELD_LABELS,
    type ClubImportFieldKey,
    type ClubImportMapping,
    suggestMapping,
} from './club-import-fields'

const column = z.number().int().min(0).max(1000).optional()

// Field → column index of the uploaded file; an absent field is not imported.
export const ClubImportMappingSchema = z.object({
    fullName: column,
    lastname: column,
    firstname: column,
    email: column,
    phone: column,
    dateOfBirth: column,
    parentEmail: column,
    gym: column,
    direction: column,
    group: column,
    rank: column,
    stripes: column,
    plan: column,
    startDate: column,
    endDate: column,
    classesLeft: column,
    paid: column,
    notes: column,
}) satisfies z.ZodType<ClubImportMapping>

export const CLUB_IMPORT_STATUSES = [
    'uploaded',
    'previewing',
    'previewed',
    'applying',
    'applied',
    'failed',
] as const

export const CLUB_IMPORT_ROW_ACTIONS = [
    'create',
    'update',
    'invite',
    'skip',
    'error',
] as const

export type ClubImportRowAction = (typeof CLUB_IMPORT_ROW_ACTIONS)[number]

export const ClubImportRowResultSchema = z.object({
    // Line number in the file (the header is line 1).
    line: z.number().int(),
    name: z.string(),
    email: z.string().nullable(),
    action: z.enum(CLUB_IMPORT_ROW_ACTIONS),
    // What the row does (or did): «новый участник», «группа «Дети»», …
    changes: z.array(z.string()),
    // Why a row is skipped/failed, and parts of it that were left out.
    messages: z.array(z.string()),
})
export type ClubImportRowResult = z.infer<typeof ClubImportRowResultSchema>

export const ClubImportSummarySchema = z.object({
    rows: z.number().int(),
    create: z.number().int(),
    update: z.number().int(),
    invite: z.number().int(),
    skip: z.number().int(),
    error: z.number().int(),
    children: z.number().int(),
    groupMemberships: z.number().int(),
    subscriptions: z.number().int(),
    ranks: z.number().int(),
    // Entities created by «Создать недостающие» (would be, in a preview).
    createdGyms: z.number().int(),
    createdDirections: z.number().int(),
    createdGroups: z.number().int(),
    createdPlans: z.number().int(),
    createdRanks: z.number().int(),
})
export type ClubImportSummary = z.infer<typeof ClubImportSummarySchema>

// Names the file uses that the club doesn't have (before this import).
export const ClubImportMissingSchema = z.object({
    gyms: z.array(z.string()),
    directions: z.array(z.string()),
    groups: z.array(z.string()),
    plans: z.array(z.string()),
    ranks: z.array(z.string()),
})
export type ClubImportMissing = z.infer<typeof ClubImportMissingSchema>

export const ClubImportOutputSchema = z.object({
    id: z.string().uuid(),
    status: z.enum(CLUB_IMPORT_STATUSES),
    fileName: z.string(),
    encoding: z.string(),
    delimiter: z.string(),
    headers: z.array(z.string()),
    // First rows of the file, for the mapping step.
    sampleRows: z.array(z.array(z.string())),
    rowCount: z.number().int(),
    // Confirmed mapping, or the auto-detected one before the first preview.
    mapping: ClubImportMappingSchema,
    createMissing: z.boolean(),
    overwrite: z.boolean(),
    processed: z.number().int(),
    total: z.number().int(),
    summary: ClubImportSummarySchema.nullable(),
    missing: ClubImportMissingSchema.nullable(),
    error: z.string().nullable(),
    // The fields the mapping step offers, in order.
    fields: z.array(
        z.object({ key: z.enum(CLUB_IMPORT_FIELD_KEYS), label: z.string() }),
    ),
    createdAt: z.iso.datetime(),
    previewedAt: z.iso.datetime().nullable(),
    appliedAt: z.iso.datetime().nullable(),
})
export type ClubImportOutput = z.infer<typeof ClubImportOutputSchema>

const SAMPLE_ROWS = 5

export type ClubImportRow = {
    id: string
    status: string
    fileName: string
    encoding: string
    delimiter: string
    headers: unknown
    rows: unknown
    mapping: unknown
    createMissing: boolean
    overwrite: boolean
    processed: number
    total: number
    summary: unknown
    missing: unknown
    error: string | null
    createdAt: Date
    previewedAt: Date | null
    appliedAt: Date | null
}

export const serializeClubImport = (
    row: ClubImportRow,
): ClubImportOutput => {
    const rows = row.rows as string[][]
    return {
        id: row.id,
        status: row.status.toLowerCase() as ClubImportOutput['status'],
        fileName: row.fileName,
        encoding: row.encoding,
        delimiter: row.delimiter,
        headers: row.headers as string[],
        sampleRows: rows.slice(0, SAMPLE_ROWS),
        rowCount: rows.length,
        mapping:
            (row.mapping as ClubImportMapping | null) ??
            suggestMapping(row.headers as string[]),
        createMissing: row.createMissing,
        overwrite: row.overwrite,
        processed: row.processed,
        total: row.total,
        summary: (row.summary as ClubImportSummary | null) ?? null,
        missing: (row.missing as ClubImportMissing | null) ?? null,
        error: row.error,
        fields: CLUB_IMPORT_FIELD_KEYS.map((key: ClubImportFieldKey) => ({
            key,
            label: CLUB_IMPORT_FIELD_LABELS[key],
        })),
        createdAt: row.createdAt.toISOString(),
        previewedAt: row.previewedAt?.toISOString() ?? null,
        appliedAt: row.appliedAt?.toISOString() ?? null,
    }
}
