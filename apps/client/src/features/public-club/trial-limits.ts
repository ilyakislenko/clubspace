import { CreatePublicTrialRequestInputSchema } from "@clubspace/api-client/schemas"

// The trial form's field limits, read from the request-body JSON schema
// generated from the server contract (the admin's contract-limits pattern):
// the form never retypes a server rule.
const p = CreatePublicTrialRequestInputSchema.properties

export const TRIAL_LIMITS = {
  name: p.name.maxLength,
  phone: p.phone.maxLength,
  email: p.email.maxLength,
  childName: p.childName.maxLength,
  childAge: { min: p.childAge.minimum, max: p.childAge.maximum },
  comment: p.comment.maxLength,
}
