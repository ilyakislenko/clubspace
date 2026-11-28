import { z } from 'zod'

// «Сверить выписку» (docs/design/2026-11-28-bank-statement-match.md §4):
// upload a bank statement → incoming transfers matched to unpaid abonements →
// confirm → those abonements are marked paid by transfer. Money: owner and
// admins only.

// ── Preview ────────────────────────────────────────────────────────────────

// Multipart form fields next to the file: the columns the admin picked when
// a CSV/Excel export wasn't recognised (0-based). Omitted = auto-detected.
const columnField = z.coerce.number().int().min(0).max(199).optional()
export const PreviewBankStatementInputSchema = z.object({
    dateColumn: columnField,
    amountColumn: columnField,
    payerColumn: columnField,
    purposeColumn: columnField,
})

export const BANK_STATEMENT_FORMATS = ['ONE_C', 'CSV', 'XLSX'] as const
export const BANK_STATEMENT_STATUSES = [
    'MATCHED',
    'AMBIGUOUS',
    'UNMATCHED',
    'ALREADY_MATCHED',
] as const
export const BANK_STATEMENT_REASONS = [
    'AMOUNT_EXACT',
    'AMOUNT_CLOSE',
    'PAYER_NAME',
    'PAYER_SHORT_NAME',
    'PAYER_SURNAME',
    'GUARDIAN_NAME',
    'GUARDIAN_SHORT_NAME',
    'PURPOSE_NAME',
    'PHONE',
    'DATE_CLOSE',
] as const
export const BANK_STATEMENT_FLAGS = [
    'AMOUNT_DIFFERS',
    'SEVERAL_ABONEMENTS',
    'SAME_ABONEMENT_TWICE',
    'SIMILAR_CANDIDATES',
    'MAYBE_ALREADY_MATCHED',
] as const

const BankStatementCandidateSchema = z.object({
    subscriptionId: z.uuid(),
    userId: z.uuid(),
    memberName: z.string(),
    planName: z.string(),
    // Agreed price, whole currency units.
    amount: z.number().int(),
    currency: z.string(),
    startDate: z.iso.date().nullable(),
    soldOn: z.iso.date(),
    score: z.number().int(),
    reasons: z.array(z.enum(BANK_STATEMENT_REASONS)),
    // The parent whose name matched the payer, when it was a parent.
    paidBy: z.string().nullable(),
})

const BankStatementTransactionSchema = z.object({
    // Pass back on confirm; the only thing stored about the transfer.
    fingerprint: z.string().length(64),
    date: z.iso.date(),
    // HH:MM when the file has it: the bank's time (Moscow time), as written.
    time: z.string().nullable(),
    // Exactly as in the file (kopecks as a fraction).
    amount: z.number(),
    // What confirming records as received: whole currency units.
    receivedAmount: z.number().int(),
    currency: z.string(),
    // From the file, shown for the review only — never stored.
    payer: z.string(),
    purpose: z.string(),
    docNumber: z.string().nullable(),
    status: z.enum(BANK_STATEMENT_STATUSES),
    // MATCHED only: the abonement pre-selected.
    suggestedSubscriptionId: z.uuid().nullable(),
    flags: z.array(z.enum(BANK_STATEMENT_FLAGS)),
    // Best first, at most 5.
    candidates: z.array(BankStatementCandidateSchema),
    // ALREADY_MATCHED: the abonement this transfer was confirmed for.
    matchedTo: z
        .object({
            subscriptionId: z.uuid(),
            userId: z.uuid().nullable(),
            memberName: z.string(),
            planName: z.string(),
            matchedAt: z.iso.datetime(),
        })
        .nullable(),
})

export const PreviewBankStatementOutputSchema = z.object({
    format: z.enum(BANK_STATEMENT_FORMATS),
    // Outgoing, failed or unreadable operations left out.
    skippedDebits: z.number().int(),
    // false: the file doesn't tell incoming from outgoing (an unsigned amount
    // without a direction column) — nothing is pre-selected.
    directionKnown: z.boolean(),
    // CSV / Excel: the columns read. `complete` false = pick them and upload
    // the file again with the column fields.
    columns: z
        .object({
            complete: z.boolean(),
            headers: z.array(z.string()),
            sample: z.array(z.array(z.string())),
            date: z.number().int().nullable(),
            amount: z.number().int().nullable(),
            payer: z.number().int().nullable(),
            purpose: z.number().int().nullable(),
        })
        .nullable(),
    transactions: z.array(BankStatementTransactionSchema),
    counts: z.object({
        matched: z.number().int(),
        ambiguous: z.number().int(),
        unmatched: z.number().int(),
        alreadyMatched: z.number().int(),
    }),
})

export type BankStatementUpload = { bytes: Uint8Array }

export class PreviewBankStatementFeature {
    constructor(
        readonly payload: z.infer<typeof PreviewBankStatementInputSchema>,
        readonly file: BankStatementUpload,
        readonly workspaceId: string,
        readonly invokerUserId: string,
        readonly roleName: string | null,
        readonly isSuperAdmin: boolean,
    ) {}
}
export type PreviewBankStatementFeatureResponse = z.infer<typeof PreviewBankStatementOutputSchema>

// ── Confirm ────────────────────────────────────────────────────────────────

export const BANK_STATEMENT_CONFIRM_MAX = 500

export const ConfirmBankStatementInputSchema = z.object({
    matches: z
        .array(
            z.object({
                fingerprint: z.string().regex(/^[0-9a-f]{64}$/),
                subscriptionId: z.uuid(),
                // Whole currency units received (the mark-paid bound).
                amount: z.number().int().min(1).max(10_000_000),
                // The transfer's day as the bank wrote it and, when the file
                // has it, the bank's time (Moscow time for RU bank exports).
                paidOn: z.iso.date(),
                paidTime: z
                    .string()
                    .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
                    .nullable()
                    .optional(),
            }),
        )
        .min(1)
        .max(BANK_STATEMENT_CONFIRM_MAX),
})

export const BANK_STATEMENT_RESULTS = ['CONFIRMED', 'ALREADY_MATCHED', 'FAILED'] as const

export const ConfirmBankStatementOutputSchema = z.object({
    confirmed: z.number().int(),
    results: z.array(
        z.object({
            fingerprint: z.string(),
            subscriptionId: z.uuid(),
            status: z.enum(BANK_STATEMENT_RESULTS),
            // FAILED: why (already paid by hand, cancelled, not found).
            message: z.string().nullable(),
        }),
    ),
})

export class ConfirmBankStatementFeature {
    constructor(
        readonly payload: z.infer<typeof ConfirmBankStatementInputSchema>,
        readonly workspaceId: string,
        readonly invokerUserId: string,
        readonly roleName: string | null,
        readonly isSuperAdmin: boolean,
    ) {}
}
export type ConfirmBankStatementFeatureResponse = z.infer<typeof ConfirmBankStatementOutputSchema>
