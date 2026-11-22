// Command-line options of the backfill scripts, as typed by hand or as
// `nx run … -- --flag` forwards them (`--flag=true`).

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** `--rescan-auto`, `--rescan-auto=true`, `--rescanAuto`. */
export const hasFlag = (argv: readonly string[], name: string) => {
    const pattern = new RegExp(`^--${name.replace(/-/g, '-?')}(=true)?$`, 'i')
    return argv.some((arg) => pattern.test(arg))
}

/**
 * Video ids from `--video <id>` (repeatable), `--video=<id>` or
 * `--video=<id>,<id>`. Throws on anything that is not a video id.
 */
export const videoIdsFrom = (argv: readonly string[]) => {
    const ids = argv
        .flatMap((arg, idx) =>
            arg === '--video'
                ? [argv[idx + 1] ?? '']
                : arg.startsWith('--video=')
                  ? [arg.slice('--video='.length)]
                  : [],
        )
        .flatMap((value) => value.split(','))
        .map((value) => value.trim())
    const bad = ids.find((id) => !UUID.test(id))
    if (bad !== undefined) throw new Error(`--video takes a video id, got «${bad}»`)
    return ids
}
