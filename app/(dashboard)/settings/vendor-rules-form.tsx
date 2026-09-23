'use client'

import { useEffect, useMemo, useState } from 'react'
import { Loader2, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { getVendorRulesPage, saveVendorRule } from '@/app/actions/expenses'
import type { VendorMode, VendorRule, VendorRuleInput } from '@/lib/expenses/types'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import type { XeroAccountOption, XeroContactOption, XeroTrackingCategory } from '@/lib/xero/bills'

const NONE = '__none__'

function splitList(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

function contactLabel(contactId: string | null, contacts: XeroContactOption[]): string | null {
  if (!contactId) return null
  return contacts.find((contact) => contact.id === contactId)?.name || 'Saved contact'
}

function suggestedContact(vendorName: string, contacts: XeroContactOption[]): XeroContactOption | null {
  const needle = vendorName.trim().toLowerCase()
  if (needle.length < 3) return null
  const exact = contacts.filter((contact) => contact.name.trim().toLowerCase() === needle)
  if (exact.length === 1) return exact[0]
  const close = contacts.filter((contact) => {
    const name = contact.name.trim().toLowerCase()
    return name.includes(needle) || (name.length >= 4 && needle.includes(name))
  })
  return close.length === 1 ? close[0] : null
}

function VendorRules({
  rules,
  contacts,
  onAdd,
  onEdit,
}: {
  rules: VendorRule[]
  contacts: XeroContactOption[]
  onAdd: () => void
  onEdit: (rule: VendorRule) => void
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3">
        <div>
          <CardTitle>Vendor rules</CardTitle>
          <CardDescription>
            These tell the filer which emails to save, and how a bill from that vendor is coded.
          </CardDescription>
        </div>
        <Button type="button" size="sm" onClick={onAdd}>
          <Plus className="mr-2 h-4 w-4" />
          Add vendor
        </Button>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Vendor</TableHead>
              <TableHead>Capture</TableHead>
              <TableHead>Xero</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rules.map((rule) => (
              <TableRow key={rule.id}>
                <TableCell>
                  <div className="font-medium">{rule.vendor_name}</div>
                  <div className="text-xs text-muted-foreground">{rule.vendor_key}</div>
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {rule.is_capture_active ? rule.mode : 'Paused'}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {rule.default_account_code || 'No account'}
                  {' · '}
                  {contactLabel(rule.xero_contact_id, contacts) || 'no contact'}
                </TableCell>
                <TableCell className="text-right">
                  <Button type="button" variant="outline" size="sm" onClick={() => onEdit(rule)}>
                    Edit
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}

function emptyRule(): VendorRuleInput {
  return {
    vendor_name: '',
    sender_domains: [],
    subject_keywords: [],
    raw_query_override: null,
    mode: 'attachment',
    link_domain_hint: null,
    link_fallback: false,
    folder_name: null,
    is_capture_active: true,
    xero_contact_id: null,
    default_account_code: null,
    default_tracking_category_id: null,
    default_tracking_option_id: null,
  }
}

function VendorRuleDialog({
  open,
  rule,
  accounts,
  contacts,
  tracking,
  onOpenChange,
  onSaved,
}: {
  open: boolean
  rule: VendorRule | null
  accounts: XeroAccountOption[]
  contacts: XeroContactOption[]
  tracking: XeroTrackingCategory[]
  onOpenChange: (open: boolean) => void
  onSaved: () => void
}) {
  const [form, setForm] = useState<VendorRuleInput>(emptyRule())
  const [domains, setDomains] = useState('')
  const [keywords, setKeywords] = useState('')
  const [contactQuery, setContactQuery] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    if (!rule) {
      setForm(emptyRule())
      setDomains('')
      setKeywords('')
      setContactQuery('')
      return
    }
    const suggestion = rule.xero_contact_id ? null : suggestedContact(rule.vendor_name, contacts)
    setForm({
      vendor_name: rule.vendor_name,
      sender_domains: rule.sender_domains,
      subject_keywords: rule.subject_keywords,
      raw_query_override: rule.raw_query_override,
      mode: rule.mode,
      link_domain_hint: rule.link_domain_hint,
      link_fallback: rule.link_fallback,
      folder_name: rule.folder_name,
      is_capture_active: rule.is_capture_active,
      xero_contact_id: rule.xero_contact_id || suggestion?.id || null,
      default_account_code: rule.default_account_code,
      default_tracking_category_id: rule.default_tracking_category_id,
      default_tracking_option_id: rule.default_tracking_option_id,
    })
    setDomains(rule.sender_domains.join(', '))
    setKeywords(rule.subject_keywords.join(', '))
    setContactQuery(rule.xero_contact_id ? '' : rule.vendor_name)
  }, [open, rule, contacts])

  const contactOptions = useMemo(() => {
    const query = contactQuery.trim().toLowerCase()
    const matches = contacts.filter((contact) => !query || contact.name.toLowerCase().includes(query))
    const shown = matches.slice(0, 50)
    const selectedId = form.xero_contact_id
    const selected = contacts.find((contact) => contact.id === selectedId)
    if (selected && !shown.some((contact) => contact.id === selected.id)) shown.unshift(selected)
    if (selectedId && !selected && !shown.some((contact) => contact.id === selectedId)) {
      shown.unshift({ id: selectedId, name: 'Saved contact' })
    }
    return shown
  }, [contactQuery, contacts, form.xero_contact_id])

  const matchedFromName = Boolean(
    rule &&
      !rule.xero_contact_id &&
      form.xero_contact_id &&
      suggestedContact(rule.vendor_name, contacts)?.id === form.xero_contact_id
  )

  function setTracking(optionId: string) {
    if (!optionId) {
      setForm((current) => ({
        ...current,
        default_tracking_option_id: null,
        default_tracking_category_id: null,
      }))
      return
    }
    const category = tracking.find((item) => item.options.some((option) => option.id === optionId))
    setForm((current) => ({
      ...current,
      default_tracking_option_id: optionId,
      default_tracking_category_id: category?.id || null,
    }))
  }

  async function save() {
    setSaving(true)
    try {
      const result = await saveVendorRule({
        ...form,
        id: rule?.id,
        sender_domains: splitList(domains),
        subject_keywords: splitList(keywords),
        mode: form.mode as VendorMode,
      })
      if (result.error) {
        toast.error(result.error)
      } else {
        toast.success(rule ? 'Vendor updated' : 'Vendor added')
        onOpenChange(false)
        onSaved()
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{rule ? rule.vendor_name : 'Add vendor'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="vendor-name">Vendor name</Label>
            <Input
              id="vendor-name"
              value={form.vendor_name}
              onChange={(event) => setForm((current) => ({ ...current, vendor_name: event.target.value }))}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="vendor-domains">Sender domains</Label>
            <Input
              id="vendor-domains"
              value={domains}
              placeholder="vercel.com, stripe.com"
              onChange={(event) => setDomains(event.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="vendor-keywords">Subject keywords</Label>
            <Input
              id="vendor-keywords"
              value={keywords}
              placeholder="invoice, receipt"
              onChange={(event) => setKeywords(event.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="vendor-query">Gmail search override</Label>
            <Textarea
              id="vendor-query"
              value={form.raw_query_override || ''}
              placeholder="Used instead of domains and keywords when set"
              onChange={(event) =>
                setForm((current) => ({ ...current, raw_query_override: event.target.value || null }))
              }
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Mode</Label>
              <Select
                value={form.mode}
                onValueChange={(value) => setForm((current) => ({ ...current, mode: value as VendorMode }))}
              >
                <SelectTrigger className="w-full" size="sm" aria-label="Capture mode">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="attachment">Attachment</SelectItem>
                  <SelectItem value="link">Link</SelectItem>
                  <SelectItem value="snapshot">Snapshot</SelectItem>
                  <SelectItem value="flag">Flag only</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="vendor-hint">Link hint</Label>
              <Input
                id="vendor-hint"
                value={form.link_domain_hint || ''}
                onChange={(event) =>
                  setForm((current) => ({ ...current, link_domain_hint: event.target.value || null }))
                }
              />
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.link_fallback}
              onChange={(event) => setForm((current) => ({ ...current, link_fallback: event.target.checked }))}
            />
            If there is no attachment, follow a link
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.is_capture_active}
              onChange={(event) =>
                setForm((current) => ({ ...current, is_capture_active: event.target.checked }))
              }
            />
            Actively scanned
          </label>
          <div className="space-y-2">
            <Label htmlFor="vendor-contact">Xero contact</Label>
            {contacts.length > 0 ? (
              <>
                <Input
                  id="vendor-contact"
                  value={contactQuery}
                  placeholder="Search by contact name"
                  onChange={(event) => setContactQuery(event.target.value)}
                />
                <Select
                  value={form.xero_contact_id || NONE}
                  onValueChange={(value) =>
                    setForm((current) => ({
                      ...current,
                      xero_contact_id: value === NONE ? null : value,
                    }))
                  }
                >
                  <SelectTrigger className="w-full" size="sm" aria-label="Xero contact">
                    <SelectValue placeholder="Choose a contact" />
                  </SelectTrigger>
                  <SelectContent className="max-h-72">
                    <SelectItem value={NONE}>No contact</SelectItem>
                    {contactOptions.map((contact) => (
                      <SelectItem key={contact.id} value={contact.id}>
                        {contact.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  {matchedFromName
                    ? 'Matched from the vendor name. Save to keep this contact.'
                    : contactOptions.length === 0
                      ? 'No contacts match that name.'
                      : 'The contact ID is saved with the vendor.'}
                </p>
              </>
            ) : (
              <Input
                id="vendor-contact"
                value={form.xero_contact_id || ''}
                placeholder="Paste a Xero contact ID"
                onChange={(event) =>
                  setForm((current) => ({ ...current, xero_contact_id: event.target.value || null }))
                }
              />
            )}
          </div>
          <div className="space-y-2">
            <Label>Default account</Label>
            <Select
              value={form.default_account_code || NONE}
              onValueChange={(value) =>
                setForm((current) => ({
                  ...current,
                  default_account_code: value === NONE ? null : value,
                }))
              }
            >
              <SelectTrigger className="w-full" size="sm" aria-label="Default account">
                <SelectValue placeholder="Account" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>No account</SelectItem>
                {accounts.map((account) => (
                  <SelectItem key={account.code} value={account.code}>
                    {account.code} {account.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {tracking.length > 0 && (
            <div className="space-y-2">
              <Label>Default tracking</Label>
              <Select
                value={form.default_tracking_option_id || NONE}
                onValueChange={(value) => setTracking(value === NONE ? '' : value)}
              >
                <SelectTrigger className="w-full" size="sm" aria-label="Default tracking">
                  <SelectValue placeholder="Tracking" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>No tracking</SelectItem>
                  {tracking.flatMap((category) =>
                    category.options.map((option) => (
                      <SelectItem key={option.id} value={option.id}>
                        {category.name}: {option.name}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button type="button" onClick={() => void save()} disabled={saving}>
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

interface XeroCoding {
  connected: boolean
  accounts: XeroAccountOption[]
  contacts: XeroContactOption[]
  tracking: XeroTrackingCategory[]
  error: string | null
}

export function VendorRulesForm() {
  const [rules, setRules] = useState<VendorRule[]>([])
  const [xero, setXero] = useState<XeroCoding | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [ruleOpen, setRuleOpen] = useState(false)
  const [editingRule, setEditingRule] = useState<VendorRule | null>(null)

  useEffect(() => {
    void load()
  }, [])

  async function load() {
    setLoading(true)
    try {
      const result = await getVendorRulesPage()
      if (result.error || !result.vendorRules || !result.xero) {
        setLoadError(result.error || 'Could not load vendor rules')
        setRules([])
        setXero(null)
      } else {
        setLoadError(null)
        setRules(result.vendorRules)
        setXero(result.xero)
      }
    } catch (error) {
      console.error('Error loading vendor rules:', error)
      setLoadError('Could not load vendor rules')
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (loadError || !xero) {
    return <p className="text-sm text-muted-foreground">{loadError || 'Could not load vendor rules'}</p>
  }

  return (
    <>
      {xero.error && <p className="text-sm text-muted-foreground">{xero.error}</p>}
      <VendorRules
        rules={rules}
        contacts={xero.contacts}
        onAdd={() => {
          setEditingRule(null)
          setRuleOpen(true)
        }}
        onEdit={(rule) => {
          setEditingRule(rule)
          setRuleOpen(true)
        }}
      />
      <VendorRuleDialog
        open={ruleOpen}
        rule={editingRule}
        accounts={xero.accounts}
        contacts={xero.contacts}
        tracking={xero.tracking}
        onOpenChange={setRuleOpen}
        onSaved={() => void load()}
      />
    </>
  )
}
