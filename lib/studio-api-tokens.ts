import { createHash, randomBytes } from 'crypto'

export const STUDIO_API_TOKEN_PREFIX = 'salo_'

/** Generate a plaintext token. Shown once; only the hash is stored. */
export function generateStudioApiToken(): { token: string; prefix: string; hash: string } {
  const secret = randomBytes(24).toString('base64url')
  const token = `${STUDIO_API_TOKEN_PREFIX}${secret}`
  const prefix = token.slice(0, 12)
  const hash = hashStudioApiToken(token)
  return { token, prefix, hash }
}

export function hashStudioApiToken(token: string): string {
  return createHash('sha256').update(token.trim()).digest('hex')
}

export function looksLikeStudioApiToken(token: string): boolean {
  return token.trim().startsWith(STUDIO_API_TOKEN_PREFIX) && token.trim().length > 20
}
