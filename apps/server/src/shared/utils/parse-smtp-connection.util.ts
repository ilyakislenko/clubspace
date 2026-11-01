import { type ConnectionUrlOptions, parseConnectionUrl } from 'nodemailer/lib/shared'

export function parseSmtpConnectionUrl(connectionsString: string): ConnectionUrlOptions {
    const connection = parseConnectionUrl(connectionsString)
    if (connection.auth) {
        return {
            ...connection,
            auth: {
                ...connection.auth,
                pass: connection.auth.pass.split('SLASH').join('/'),
            },
        }
    }
    return connection
}
