export * from "./lib/api-client";

// Single source of truth for request/response shapes, generated from the
// server's open-api.json (nx types:generate @clubspace/api-client) and
// drift-checked in CI. Namespaced because a few names (SignInResponse,
// RefreshTokenResponse, ...) collide with the hand-written auth-api exports.
//
//   import type { ApiTypes } from '@clubspace/api-client'
//   type Me = ApiTypes.GetMeOutputOutput
export type * as ApiTypes from "./openapi";
