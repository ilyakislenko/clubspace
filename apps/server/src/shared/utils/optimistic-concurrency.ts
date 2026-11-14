import { z } from 'zod'

import { StaleUpdateError } from '../errors/shared.errors'

// Optimistic concurrency for edit forms (admin cleanup F10). An update input
// spreads this field; the client sends the `updatedAt` it last read. Omitted =
// no check (mobile, MCP and older callers keep last-write-wins).
export const ExpectedUpdatedAtField = {
    expectedUpdatedAt: z.iso
        .datetime()
        .optional()
        .describe(
            'The updatedAt the client last read; a newer row refuses the save with 409 STALE_UPDATE',
        ),
}

// Compare-and-set before the write: `claim` is a conditional `updateMany`
// (id + the version column = `expected`) that bumps the version, run in the
// same transaction as the real update. The row lock it takes holds until
// commit, so a second writer with the same stale timestamp matches nothing —
// never read-then-write.
export const claimUnchanged = async (
    expectedUpdatedAt: string | undefined,
    claim: (expected: Date) => PromiseLike<{ count: number }>,
): Promise<void> => {
    if (expectedUpdatedAt === undefined) return
    const { count } = await claim(new Date(expectedUpdatedAt))
    if (count === 0) throw new StaleUpdateError()
}
