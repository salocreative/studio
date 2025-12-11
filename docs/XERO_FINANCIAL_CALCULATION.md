# Xero Financial Data Calculation

## Current Implementation

The Financial Overview on the Forecast page calculates revenue and expenses from Xero using the following logic:

### Revenue Calculation
1. Fetches **all invoices** from Xero API (`/Invoices`)
2. Filters invoices where:
   - Invoice **Date** (or DateString) falls within the selected date range
   - Status is **PAID** or **AUTHORISED** only
3. Sums the **Total** field (which includes VAT)
4. Only includes invoices with Total > 0

### Expenses Calculation
1. Fetches **all bills** from Xero API (`/Bills`)
2. Filters bills where:
   - Bill **Date** (or DateString) falls within the selected date range
   - Status is **PAID** or **AUTHORISED** only
3. Sums the **Total** field (which includes VAT)
4. Only includes bills with Total > 0

### Profit Calculation
`Profit = Revenue - Expenses`

## Differences from Xero Profit & Loss Report

There are several key differences that may cause discrepancies:

### 1. Status Filtering
- **Current implementation**: Only includes invoices/bills with status `PAID` or `AUTHORISED`
- **Xero P&L**: Typically includes ALL invoices/bills (including SUBMITTED, DRAFT, etc.) based on accrual accounting principles
- **Impact**: Your calculated revenue/expenses may be lower if you have unpaid invoices/bills

### 2. VAT Inclusion
- **Current implementation**: Uses `invoice.Total` which **includes VAT**
- **Xero P&L**: Typically shows SubTotal (excluding VAT) with VAT as separate line items
- **Impact**: Revenue/expenses are inflated by VAT amount

### 3. Credit Notes
- **Current implementation**: Not explicitly handled (may be included as negative totals)
- **Xero P&L**: Credit notes are typically shown separately or netted against revenue/expenses

### 4. Account Categorization
- **Current implementation**: Simply sums all invoices (revenue) and all bills (expenses)
- **Xero P&L**: Uses account categories (e.g., income accounts, expense accounts) and may exclude certain accounts

### 5. Accrual vs Cash Accounting
- **Current implementation**: Uses invoice/bill DATE (accrual-based) but only includes PAID/AUTHORISED (cash-based filtering)
- **Xero P&L**: Typically uses pure accrual accounting (all invoices/bills based on date, regardless of payment status)

## Recommended Improvements

To better match Xero's Profit & Loss report, consider:

1. **Include all statuses** (or make it configurable)
   - Remove status filtering, or add settings to choose which statuses to include

2. **Use SubTotal instead of Total** (exclude VAT)
   - Use `invoice.SubTotal` instead of `invoice.Total`
   - This matches how P&L typically shows revenue/expenses

3. **Use Xero Reports API** (best option)
   - Xero provides a Reports API that can fetch the actual Profit & Loss report
   - This would give exact matches: `GET /api.xro/2.0/Reports/ProfitAndLoss`
   - Requires specifying date range and accounting method (accrual/cash)

4. **Handle credit notes explicitly**
   - Check for `Type === "ACCRECCREDIT"` or `Type === "ACCPAYCREDIT"`
   - Subtract credit note amounts from revenue/expenses

## Example: Xero Reports API Approach

```typescript
// Fetch actual P&L report from Xero
const pnlUrl = `${XERO_API_BASE}/Reports/ProfitAndLoss?fromDate=${startDate}&toDate=${endDate}&periods=1&standardLayout=true`
```

This would return structured data matching exactly what you see in Xero's P&L report.

## Current Code Location

- **Main function**: `lib/xero/api.ts` → `fetchXeroFinancialData()`
- **Called from**: `app/actions/xero.ts` → `getFinancialData()`
- **Used in**: `app/(dashboard)/forecast/forecast-client.tsx` → `loadFinancialData()`

