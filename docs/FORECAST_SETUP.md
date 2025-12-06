# Forecast Page - Setup Guide

## Overview

The Forecast page provides financial forecasting and planning by combining:
- **Real financial data** from Xero (revenue, expenses, profit)
- **Leads data** from Monday.com (potential future revenue)
- **Historical performance** data

## What's Been Built

### ✅ Completed Components

1. **Database Migration** (`007_add_xero_integration.sql`)
   - `xero_connection` table for OAuth tokens
   - `xero_financial_cache` table for caching financial data

2. **Xero Integration**
   - OAuth 2.0 flow handlers
   - API client for fetching financial data
   - Token refresh logic
   - Connection management

3. **Settings UI**
   - Xero connection button in Settings page
   - Connection status display
   - Disconnect option

4. **Forecast Page**
   - Financial overview cards (Revenue, Expenses, Profit)
   - Leads summary with potential revenue
   - Period selector (Last/Current/Next month)
   - Basic forecast projections

## Setup Instructions

### Step 1: Run Database Migration

Run the migration in your Supabase Dashboard:

```sql
-- File: supabase/migrations/007_add_xero_integration.sql
```

Or via Supabase CLI:
```bash
supabase migration up
```

### Step 2: Configure Xero OAuth App

1. Go to [Xero Developer Portal](https://developer.xero.com/)
2. Create a new **Web app**
3. Configure:
   - **Redirect URI**: `https://admin.salo.uk/api/xero/callback` (production)
   - **Redirect URI**: `http://localhost:3000/api/xero/callback` (local dev)
   - **Scopes**: 
     - `accounting.transactions`
     - `accounting.reports.read`
     - `accounting.contacts`
     - `accounting.settings`

### Step 3: Set Environment Variables

Add to `.env.local` (and Vercel):

```env
XERO_CLIENT_ID=your_xero_client_id
XERO_CLIENT_SECRET=your_xero_client_secret
XERO_REDIRECT_URI=https://admin.salo.uk/api/xero/callback
```

For local development:
```env
XERO_REDIRECT_URI=http://localhost:3000/api/xero/callback
```

### Step 4: Connect Xero

1. Go to **Settings → Xero Integration**
2. Click **"Connect to Xero"**
3. Authorize the connection in Xero
4. Select your organization
5. You'll be redirected back to Settings

### Step 5: View Forecast

1. Go to **Forecast** page
2. Select a period (Last/Current/Next month)
3. View financial data and leads projections

## Current Features

### Financial Overview
- **Revenue**: From paid invoices in Xero
- **Expenses**: From paid bills in Xero
- **Profit**: Revenue minus expenses

### Leads Summary
- Total number of leads
- Total quoted hours
- Potential revenue (estimated at configurable hourly rate)

### Forecast Projections
- Current period financial summary
- Potential revenue from leads conversion

## Future Enhancements

The current implementation is simplified. Potential enhancements:

1. **Better Financial Data**
   - Use Xero Profit & Loss reports for accurate categorization
   - Include unpaid invoices/bills
   - Handle different currencies
   - Cache data for performance

2. **Advanced Forecasting**
   - Trend analysis and projections
   - Multiple period comparisons
   - Conversion probability for leads
   - Resource capacity planning integration

3. **Visualizations**
   - Revenue/expense charts over time
   - Profit margin trends
   - Lead conversion funnel
   - Forecast vs actual comparisons

4. **Configuration**
   - Configurable hourly rates
   - Lead conversion probabilities
   - Forecast assumptions and scenarios

## Troubleshooting

### Xero Connection Issues
- Verify redirect URI matches exactly in Xero app settings
- Check environment variables are set correctly
- Ensure scopes are properly configured
- Check token expiration (tokens auto-refresh)

### Financial Data Not Showing
- Verify Xero connection status in Settings
- Check Xero API rate limits (1000 requests/minute)
- Ensure invoices/bills exist in the selected period
- Check browser console for API errors

### Forecast Accuracy
- Ensure leads have accurate quoted hours
- Update hourly rate assumptions (currently hardcoded at £75/hour)
- Regularly sync financial data from Xero

## Notes

- The current implementation uses a simplified approach (invoices/bills)
- Hourly rate for lead revenue estimation is hardcoded (£75) - should be configurable
- Financial data is fetched in real-time (consider caching for performance)
- The Forecast page works even without Xero (shows leads only)

