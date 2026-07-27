'use client'

import { useEffect, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Check, Copy, KeyRound, Loader2, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import {
  createStudioApiToken,
  deleteStudioApiToken,
  listStudioApiTokens,
  revokeStudioApiToken,
  type StudioApiTokenRow,
} from '@/app/actions/studio-api-tokens'

export function StudioApiTokensForm() {
  const [tokens, setTokens] = useState<StudioApiTokenRow[]>([])
  const [loading, setLoading] = useState(true)
  const [name, setName] = useState('')
  const [creating, setCreating] = useState(false)
  const [plaintextToken, setPlaintextToken] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)

  useEffect(() => {
    void load()
  }, [])

  async function load() {
    setLoading(true)
    try {
      const result = await listStudioApiTokens()
      if (result.error) {
        toast.error('Could not load API tokens', { description: result.error })
        setTokens([])
      } else {
        setTokens(result.tokens || [])
      }
    } finally {
      setLoading(false)
    }
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    setCreating(true)
    try {
      const result = await createStudioApiToken(name)
      if (result.error) {
        toast.error('Could not create token', { description: result.error })
        return
      }
      setName('')
      setPlaintextToken(result.plaintextToken || null)
      toast.success('API token created')
      await load()
    } finally {
      setCreating(false)
    }
  }

  async function handleCopy() {
    if (!plaintextToken) return
    try {
      await navigator.clipboard.writeText(plaintextToken)
      setCopied(true)
      toast.success('Token copied')
      setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error('Could not copy token')
    }
  }

  async function handleRevoke(token: StudioApiTokenRow) {
    if (!confirm(`Revoke “${token.name}”? Plugins using it will stop working.`)) return
    setBusyId(token.id)
    try {
      const result = await revokeStudioApiToken(token.id)
      if (result.error) {
        toast.error('Could not revoke token', { description: result.error })
      } else {
        toast.success('Token revoked')
        await load()
      }
    } finally {
      setBusyId(null)
    }
  }

  async function handleDelete(token: StudioApiTokenRow) {
    if (!confirm(`Permanently delete “${token.name}”?`)) return
    setBusyId(token.id)
    try {
      const result = await deleteStudioApiToken(token.id)
      if (result.error) {
        toast.error('Could not delete token', { description: result.error })
      } else {
        toast.success('Token deleted')
        await load()
      }
    } finally {
      setBusyId(null)
    }
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <KeyRound className="h-5 w-5" />
            Studio API tokens
          </CardTitle>
          <CardDescription>
            Create tokens for the Figma → Flexi Gallery plugin and other integrations. Tokens are
            shown once at creation — store them securely.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <form onSubmit={handleCreate} className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex-1 space-y-2">
              <Label htmlFor="api-token-name">Token name</Label>
              <Input
                id="api-token-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Figma plugin — Design team"
                required
              />
            </div>
            <Button type="submit" disabled={creating || !name.trim()}>
              {creating ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Plus className="mr-2 h-4 w-4" />
              )}
              Create token
            </Button>
          </form>

          <div className="rounded-md border bg-muted/40 p-3 text-sm text-muted-foreground">
            <p className="font-medium text-foreground">Figma plugin endpoints</p>
            <ul className="mt-2 list-inside list-disc space-y-1 font-mono text-xs">
              <li>GET /api/figma/flexi-clients</li>
              <li>POST /api/figma/gallery-upload</li>
            </ul>
            <p className="mt-2">
              Send header <code className="text-foreground">Authorization: Bearer salo_…</code>
            </p>
          </div>

          {loading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : tokens.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">No API tokens yet</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Prefix</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>Last used</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tokens.map((token) => (
                  <TableRow key={token.id}>
                    <TableCell className="font-medium">
                      {token.name}
                      {token.created_by_name && (
                        <div className="text-xs text-muted-foreground">
                          by {token.created_by_name}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="font-mono text-xs">{token.token_prefix}…</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {new Date(token.created_at).toLocaleDateString()}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {token.last_used_at
                        ? new Date(token.last_used_at).toLocaleString()
                        : 'Never'}
                    </TableCell>
                    <TableCell>
                      {token.revoked_at ? (
                        <Badge variant="secondary">Revoked</Badge>
                      ) : (
                        <Badge>Active</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        {!token.revoked_at && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            disabled={busyId === token.id}
                            onClick={() => void handleRevoke(token)}
                          >
                            Revoke
                          </Button>
                        )}
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          disabled={busyId === token.id}
                          onClick={() => void handleDelete(token)}
                          title="Delete"
                        >
                          {busyId === token.id ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Trash2 className="h-4 w-4" />
                          )}
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog
        open={!!plaintextToken}
        onOpenChange={(open) => {
          if (!open) {
            setPlaintextToken(null)
            setCopied(false)
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Copy your API token</DialogTitle>
            <DialogDescription>
              This is the only time the full token will be shown. Paste it into the Figma plugin
              settings.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="break-all rounded-md border bg-muted p-3 font-mono text-xs">
              {plaintextToken}
            </div>
            <Button type="button" variant="outline" className="w-full" onClick={() => void handleCopy()}>
              {copied ? (
                <>
                  <Check className="mr-2 h-4 w-4" />
                  Copied
                </>
              ) : (
                <>
                  <Copy className="mr-2 h-4 w-4" />
                  Copy token
                </>
              )}
            </Button>
          </div>
          <DialogFooter>
            <Button
              type="button"
              onClick={() => {
                setPlaintextToken(null)
                setCopied(false)
              }}
            >
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
