/**
 * Browser counterpart of `app-update.ts` (Metro picks this file for web): the
 * PWA has no OTA updates — the deploy serves the new bundle and the service
 * worker picks it up — so there is no update id to show.
 */
export const runningUpdateId = (): string | null => null
