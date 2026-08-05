import { z } from 'zod'

import { AttendanceSessionOutputSchema } from './schemas'

// Wall-clock start for ad-hoc sessions, YYYY-MM-DDTHH:MM (seconds optional).
const WallClock = z
    .string()
    .regex(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/,
        'Время должно быть в формате YYYY-MM-DDTHH:MM',
    )

// One object with a `kind` tag and per-kind optional fields, enforced by
// superRefine. A discriminated union would be cleaner conceptually but
// nestjs-zod's createZodDto cannot build a DTO class from a union type
// (its instance type is a union, not an object). A flat object also keeps
// the generated OpenAPI schema a plain object rather than the contract's
// first `oneOf`.
export const CreateAttendanceSessionInputSchema = z
    .object({
        kind: z.enum(['scheduled', 'adhoc', 'event']),
        slotId: z.string().uuid().optional(),
        sessionDate: z.iso.date().optional(),
        groupId: z.string().uuid().optional(),
        startAt: WallClock.optional(),
        title: z.string().trim().min(1).max(255).optional(),
        workspaceEventId: z.string().uuid().optional(),
    })
    .superRefine((v, ctx) => {
        if (v.kind === 'scheduled' && (!v.slotId || !v.sessionDate)) {
            ctx.addIssue({
                code: 'custom',
                message: 'Для занятия по расписанию нужны slotId и sessionDate',
            })
        }
        if (v.kind === 'adhoc' && (!v.groupId || !v.startAt || !v.title)) {
            ctx.addIssue({
                code: 'custom',
                message: 'Для разового занятия нужны группа, время начала и название',
            })
        }
        if (v.kind === 'event' && !v.workspaceEventId) {
            ctx.addIssue({
                code: 'custom',
                message: 'Для занятия по ивенту нужен workspaceEventId',
            })
        }
    })

export const CreateAttendanceSessionOutputSchema =
    AttendanceSessionOutputSchema

export class CreateAttendanceSessionFeature {
    constructor(
        readonly payload: z.infer<typeof CreateAttendanceSessionInputSchema>,
        readonly workspaceId: string,
        readonly invokerUserId: string,
        readonly roleName: string | null,
        readonly isSuperAdmin: boolean,
    ) {}
}

export type CreateAttendanceSessionFeatureResponse = z.infer<
    typeof CreateAttendanceSessionOutputSchema
>
