/** Scopes granted on the current access token. Empty if the token is not a JWT. */
export function xeroTokenScopes(accessToken: string): string[] {
  try {
    const payload = accessToken.split('.')[1]
    if (!payload) return []
    const json = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
      scope?: string | string[]
    }
    if (Array.isArray(json.scope)) return json.scope
    if (typeof json.scope === 'string') return json.scope.split(/\s+/).filter(Boolean)
    return []
  } catch {
    return []
  }
}

export function xeroTokenCanAttachFiles(accessToken: string): boolean {
  return xeroTokenScopes(accessToken).includes('accounting.attachments')
}
