# Xero Integration Guide

## Overview

The Forecast page integrates with Xero to provide real-time financial data and forecasting capabilities. This integration combines:

- **Real Financial Data** from Xero (revenue, expenses, profit)
- **Leads Data** from Monday.com (potential future revenue)
- **Performance Data** (team utilization, hours tracked)
- **Historical Trends** for accurate forecasting

## Xero OAuth Setup

### Step 1: Create a Xero App

1. Go to [Xero Developer Portal](https://developer.xero.com/)
2. Click **"My Apps"** → **"New app"**
3. Choose **"Web app"** as the integration type
4. Fill in app details:
   - **App name**: Salo Studio
   - **Company or application URL**: `https://admin.salo.uk` (or your domain)
   - **OAuth redirect URI**: `https://admin.salo.uk/api/xero/callback` (or `http://localhost:3000/api/xero/callback` for local dev)
5. Note your **Client ID** and **Client Secret**

### Step 2: Configure Scopes

Your Xero app needs the following scopes:
- `accounting.transactions`
- `accounting.reports.read`
- `accounting.contacts`
- `accounting.settings`

### Step 3: Set Environment Variables

Add to your `.env.local` (and Vercel environment variables):

```env
XERO_CLIENT_ID=your_xero_client_id
XERO_CLIENT_SECRET=your_xero_client_secret
XERO_REDIRECT_URI=https://admin.salo.uk/api/xero/callback
```

For local development:
```env
XERO_REDIRECT_URI=http://localhost:3000/api/xero/callback
```

## Database Setup

Run the migration:
```sql
supabase/migrations/007_add_xero_integration.sql
```

This creates:
- `xero_connection` table - stores OAuth tokens and tenant info
- `xero_financial_cache` table - caches financial data for performance

## Connection Flow

1. Admin goes to **Settings → Xero Integration**
2. Clicks **"Connect to Xero"**
3. Redirects to Xero OAuth consent screen
4. User selects which Xero organization to connect
5. Redirects back to Studio with authorization code
6. Server exchanges code for access/refresh tokens
7. Stores tokens securely in database

## Data Sync

Financial data is fetched from Xero API:
- **Revenue**: From invoices (paid and unpaid)
- **Expenses**: From bills and expenses
- **Profit**: Revenue minus expenses

Data is cached to reduce API calls and improve performance.

## Forecast Calculations

The Forecast page combines:

1. **Historical Financial Data** (from Xero)
   - Past revenue, expenses, profit
   - Monthly trends and averages

2. **Current Projects** (from Monday.com)
   - Active projects with quoted hours
   - Revenue potential from active work

3. **Leads** (from Monday.com leads board)
   - Potential future revenue
   - Conversion probability (configurable)

4. **Team Capacity** (from Performance data)
   - Available hours
   - Utilization rates
   - Resource constraints

## Security

- OAuth tokens are stored encrypted in the database
- Only admins can manage Xero connections
- All authenticated users can view forecasts (using cached data)
- Tokens are automatically refreshed when expired

## Troubleshooting

### Connection Issues
- Verify redirect URI matches exactly in Xero app settings
- Check environment variables are set correctly
- Ensure scopes are properly configured in Xero app

### Data Sync Issues
- Check Xero connection status in Settings
- Verify tokens haven't expired (they auto-refresh)
- Check Xero API rate limits (1000 requests per minute)

### Forecast Accuracy
- Ensure leads have accurate quoted hours
- Update conversion rates based on historical data
- Regularly sync financial data from Xero

