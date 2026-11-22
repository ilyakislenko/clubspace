// @clubspace/sport-glossary: the sport vocabulary the video worker snaps
// titles and transcripts to, and the technique catalogue built on it. An ESM
// workspace package resolved through the tsconfig path: the server bundles it
// with webpack, the worker compiles it with its own tsc (see the worker
// Dockerfile) and its scripts load it through tsx.
export * from './glossary.js'
export * from './techniques.js'
