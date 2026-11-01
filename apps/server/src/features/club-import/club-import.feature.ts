import { z } from 'zod'

import { strictBoolean } from '../../shared/utils/strict-boolean'
import {
    CLUB_IMPORT_ROW_ACTIONS,
    ClubImportMappingSchema,
    ClubImportOutputSchema,
    ClubImportRowResultSchema,
} from './schemas'

// «Импорт клуба»: upload a CSV → confirm the column mapping and options →
// background dry run (preview) → background apply. Every step is admin-only.

type Caller = {
    readonly workspaceId: string
    readonly invokerUserId: string
    readonly roleName: string | null
    readonly isSuperAdmin: boolean
}

export const UploadClubImportOutputSchema = ClubImportOutputSchema

// The file arrives as multipart (field «file»), not JSON: it may be
// Windows-1251, which only the raw bytes can tell.
export class UploadClubImportFeature implements Caller {
    constructor(
        readonly payload: { fileName: string; bytes: Uint8Array },
        readonly workspaceId: string,
        readonly invokerUserId: string,
        readonly roleName: string | null,
        readonly isSuperAdmin: boolean,
    ) {}
}

export const GetClubImportOutputSchema = ClubImportOutputSchema

export class GetClubImportFeature implements Caller {
    constructor(
        readonly importId: string,
        readonly workspaceId: string,
        readonly invokerUserId: string,
        readonly roleName: string | null,
        readonly isSuperAdmin: boolean,
    ) {}
}

export const PreviewClubImportInputSchema = z.object({
    mapping: ClubImportMappingSchema,
    // «Создать недостающие»: gyms, directions, groups, tariffs and belts the
    // file names but the club lacks are created on apply (else those rows
    // are skipped).
    createMissing: z.boolean().default(false),
    // «Перезаписать»: names, date of birth, rank and notes replace what the
    // club has (else only empty fields are filled).
    overwrite: z.boolean().default(false),
})
export const PreviewClubImportOutputSchema = ClubImportOutputSchema

export class PreviewClubImportFeature implements Caller {
    constructor(
        readonly payload: z.infer<typeof PreviewClubImportInputSchema>,
        readonly importId: string,
        readonly workspaceId: string,
        readonly invokerUserId: string,
        readonly roleName: string | null,
        readonly isSuperAdmin: boolean,
    ) {}
}

export const ApplyClubImportOutputSchema = ClubImportOutputSchema

export class ApplyClubImportFeature implements Caller {
    constructor(
        readonly importId: string,
        readonly workspaceId: string,
        readonly invokerUserId: string,
        readonly roleName: string | null,
        readonly isSuperAdmin: boolean,
    ) {}
}

export const ListClubImportRowsQuerySchema = z.object({
    action: z.enum(CLUB_IMPORT_ROW_ACTIONS).optional(),
    // Only rows with a message (skipped/failed parts) — what needs a look.
    withMessages: strictBoolean().optional(),
    offset: z.coerce.number().int().min(0).default(0),
    limit: z.coerce.number().int().min(1).max(500).default(100),
})
export const ListClubImportRowsOutputSchema = z.object({
    data: z.array(ClubImportRowResultSchema),
    total: z.number().int(),
})

export class ListClubImportRowsFeature implements Caller {
    constructor(
        readonly query: z.infer<typeof ListClubImportRowsQuerySchema>,
        readonly importId: string,
        readonly workspaceId: string,
        readonly invokerUserId: string,
        readonly roleName: string | null,
        readonly isSuperAdmin: boolean,
    ) {}
}

export class GetClubImportTemplateFeature implements Caller {
    constructor(
        readonly workspaceId: string,
        readonly invokerUserId: string,
        readonly roleName: string | null,
        readonly isSuperAdmin: boolean,
    ) {}
}

export type ClubImportFeatureResponse = z.infer<typeof ClubImportOutputSchema>
export type ListClubImportRowsFeatureResponse = z.infer<
    typeof ListClubImportRowsOutputSchema
>
