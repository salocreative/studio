'use client'

import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import type { XeroInvoiceSetup } from '@/lib/xero/invoicing'

export function InvoiceXeroCreateFields({
  idPrefix = 'create-in-xero',
  setup,
  loading,
  createInXero,
  onCreateInXeroChange,
  accountCode,
  onAccountCodeChange,
  taxType,
  onTaxTypeChange,
  selectContentClassName,
}: {
  idPrefix?: string
  setup: XeroInvoiceSetup | null
  loading: boolean
  createInXero: boolean
  onCreateInXeroChange: (checked: boolean) => void
  accountCode: string
  onAccountCodeChange: (value: string) => void
  taxType: string
  onTaxTypeChange: (value: string) => void
  selectContentClassName?: string
}) {
  const connected = Boolean(setup?.connected)

  return (
    <div className="space-y-3 rounded-lg border p-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <Label htmlFor={idPrefix}>Create in Xero</Label>
          <p className="text-xs text-muted-foreground">
            {connected
              ? `Leave this on to raise an authorised invoice in ${setup?.tenantName || 'Xero'} now. Completed sub-items become line items.`
              : 'Connect Xero in Settings to raise invoices there. Otherwise this stays in Studio as Ready to bill.'}
          </p>
        </div>
        <Switch
          id={idPrefix}
          checked={createInXero && connected}
          disabled={!connected || loading}
          onCheckedChange={onCreateInXeroChange}
        />
      </div>
      {createInXero && connected && setup ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-2">
            <Label>Account</Label>
            <Select value={accountCode} onValueChange={onAccountCodeChange}>
              <SelectTrigger aria-label="Xero account">
                <SelectValue placeholder={loading ? 'Loading…' : 'Choose account'} />
              </SelectTrigger>
              <SelectContent className={selectContentClassName}>
                {setup.accounts.map((account) => (
                  <SelectItem key={account.code} value={account.code}>
                    {account.code} - {account.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label>Tax rate</Label>
            <Select value={taxType} onValueChange={onTaxTypeChange}>
              <SelectTrigger aria-label="Tax rate">
                <SelectValue placeholder={loading ? 'Loading…' : 'Choose tax rate'} />
              </SelectTrigger>
              <SelectContent className={selectContentClassName}>
                {setup.taxRates.map((rate) => (
                  <SelectItem key={rate.taxType} value={rate.taxType}>
                    {rate.name}
                    {rate.rate ? ` (${rate.rate}%)` : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      ) : null}
    </div>
  )
}
