// Which profile the app currently acts as: null = the signed-in guardian
// themselves, else the id of a child (dependent) they switched to. Kept as a
// dependency-free module so the API client, the caches and the outbox can read
// it synchronously (and pure specs can import them). The persisted copy and the
// React state live in shared/acting-as + auth-context, which set this.

let current: string | null = null

export const getProfileScopeId = (): string | null => current

export const setProfileScopeId = (dependentId: string | null): void => {
  current = dependentId
}

// A filesystem / kv-safe suffix that separates one child's local data from the
// guardian's and the other children's. The guardian keeps the historical
// (unsuffixed) locations, so nothing moves for people without children.
export const profileSubdir = (dependentId: string | null): string =>
  dependentId ? `profiles/${dependentId.replace(/[^a-zA-Z0-9_-]/g, "_")}/` : ""

export const profileKvKey = (base: string, dependentId: string | null): string =>
  dependentId
    ? `${base}.${dependentId.replace(/[^a-zA-Z0-9_-]/g, "_")}`
    : base
