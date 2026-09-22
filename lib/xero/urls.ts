export function xeroInvoiceUrl(xeroInvoiceId: string): string {
  return `https://go.xero.com/AccountsReceivable/View.aspx?InvoiceID=${encodeURIComponent(xeroInvoiceId)}`
}
