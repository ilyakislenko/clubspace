import { z } from 'zod'

import { DemoRequestSchema } from './schemas'

// «Показать демо» on the public landing: a club that is not a customer yet
// leaves its contacts and the platform's team calls back. The request lands
// in the platform console and in the platform owner's mailbox.

// POST /public/demo-requests
export const CreateDemoRequestInputSchema = z.object({
    name: z.string().trim().min(1).max(120),
    clubName: z.string().trim().min(1).max(160),
    city: z.string().trim().max(120).optional(),
    // Phone or Telegram handle.
    contact: z.string().trim().min(3).max(120),
    studentsCount: z.number().int().min(0).max(100_000).optional(),
    comment: z.string().trim().max(2000).optional(),
    // Consent to processing the contact details (privacy policy); the
    // request is refused without it.
    consent: z.boolean(),
    // Honeypot: hidden from people, filled in by form-spamming bots. A filled
    // one is answered like a real request and dropped.
    website: z.string().max(500).optional(),
})
export const CreateDemoRequestOutputSchema = z.object({
    status: z.literal('received'),
})
export class CreateDemoRequestFeature {
    constructor(
        readonly payload: z.infer<typeof CreateDemoRequestInputSchema>,
    ) {}
}
export type CreateDemoRequestFeatureResponse = z.infer<
    typeof CreateDemoRequestOutputSchema
>

// GET /platform/demo-requests — the console's list, newest first.
export const ListPlatformDemoRequestsOutputSchema = z.object({
    data: z.array(DemoRequestSchema),
})
export class ListPlatformDemoRequestsFeature {
    constructor(
        readonly invokerUserId: string,
        readonly isSuperAdmin: boolean,
    ) {}
}
export type ListPlatformDemoRequestsFeatureResponse = z.infer<
    typeof ListPlatformDemoRequestsOutputSchema
>
