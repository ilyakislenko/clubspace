// Rejects if `work` hasn't settled within `ms`. For probes against things that
// can hang instead of failing (a dead SMTP host holds a TCP connect open far
// longer than any caller should wait).
export const withTimeout = async <T>(work: Promise<T>, ms: number): Promise<T> => {
    let timer: NodeJS.Timeout | undefined
    try {
        return await Promise.race([
            work,
            new Promise<never>((_, reject) => {
                timer = setTimeout(
                    () => reject(new Error(`timed out after ${ms}ms`)),
                    ms,
                )
            }),
        ])
    } finally {
        if (timer) clearTimeout(timer)
    }
}
