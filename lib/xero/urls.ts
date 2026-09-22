export function xeroInvoiceUrl(xeroInvoiceId: string): string {
  return `https://go.xero.com/AccountsReceivable/View.aspx?InvoiceID=${encodeURIComponent(xeroInvoiceId)}`
}

export function xeroBillUrl(xeroInvoiceId: string): string {
  return `https://go.xero.com/AccountsPayable/View.aspx?InvoiceID=${encodeURIComponent(xeroInvoiceId)}`
}
