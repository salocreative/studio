/** Client/server-safe path helpers for Flexi-Design storage */

export function buildFlexiDesignStoragePath(
  clientId: string,
  kind: 'files' | 'gallery',
  originalFileName: string
) {
  const ext = originalFileName.includes('.')
    ? originalFileName.split('.').pop()?.toLowerCase() || 'bin'
    : 'bin'
  const id =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
  return `${clientId}/${kind}/${id}.${ext}`
}
