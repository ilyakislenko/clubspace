import { DefaultError } from '../../shared/errors/default.error'

// Manual entry of a phone that already has an open lead: the admin offers
// «Открыть» on `metadata.leadId`.
export class LeadDuplicateError extends DefaultError {
    constructor(leadId: string) {
        super({
            message: 'Заявка с этим телефоном уже есть',
            code: 'LEAD_DUPLICATE',
            statusCode: 409,
            metadata: { leadId },
        })
    }
}

// The club's daily cap of public requests is reached (a flood, not a person).
export class TrialRequestsCappedError extends DefaultError {
    constructor() {
        super({
            message: 'Сейчас заявку принять не получится — позвоните в клуб',
            code: 'TRIAL_REQUESTS_CAPPED',
            statusCode: 429,
        })
    }
}
