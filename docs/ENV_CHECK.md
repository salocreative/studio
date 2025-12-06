# Environment Variables Check

## Current Status

✅ **All Required Variables Are Set**

### Required Variables:

1. **NEXT_PUBLIC_SUPABASE_URL** ✅
   - Format: `https://your-project.supabase.co`
   - Status: Set in `.env.local`

2. **NEXT_PUBLIC_SUPABASE_ANON_KEY** ✅
   - Format: JWT token (3 parts separated by dots)
   - Status: Set and valid JWT format
   - ⚠️ If you're getting "Invalid API key" error, this key might be expired or invalid

3. **SUPABASE_SERVICE_ROLE_KEY** ✅
   - Format: JWT token
   - Status: Set in `.env.local`
   - Used for: Admin operations (creating/deleting users)

4. **NEXT_PUBLIC_SITE_URL** ✅
   - Format: `http://localhost:3000` (local) or `https://your-domain.com` (production)
   - Status: Set

### Optional Variables (for integrations):

- **MONDAY_API_TOKEN** ✅
- **XERO_CLIENT_ID** ✅
- **XERO_CLIENT_SECRET** ✅
- **XERO_REDIRECT_URI** ✅

## Troubleshooting "Invalid API key" Error

If you're seeing this error, here's what to check:

### Step 1: Verify Supabase Keys Are Current

1. Go to [Supabase Dashboard](https://supabase.com/dashboard)
2. Select your project: `hlmfxwgbmrlmaueyyskn`
3. Navigate to **Settings** → **API**
4. Compare the keys:
   - **Project URL** should match `NEXT_PUBLIC_SUPABASE_URL`
   - **anon/public key** should match `NEXT_PUBLIC_SUPABASE_ANON_KEY`

### Step 2: Check if Keys Were Rotated

If the keys don't match:
1. Copy the new keys from Supabase Dashboard
2. Update `.env.local` with the new values
3. **Restart your dev server** (important!)

### Step 3: Verify Environment Variables Are Loaded

Check if Next.js is loading your environment variables:

```bash
# Restart your dev server
npm run dev

# Check the startup logs - they should NOT show warnings about missing env vars
```

### Step 4: Check Browser Console

When the error occurs:
1. Open browser DevTools (F12)
2. Go to **Console** tab
3. Look for error messages
4. Check **Network** tab for failed API requests

## Quick Fix Checklist

- [ ] Verify Supabase keys in Dashboard match `.env.local`
- [ ] Restart dev server after changing env vars
- [ ] Clear browser cache and cookies
- [ ] Check browser console for detailed error
- [ ] Verify Supabase project is active (not paused)

## Common Issues

### Issue: Keys look correct but still getting error

**Solution:**
1. Stop your dev server completely
2. Delete `.next` folder: `rm -rf .next`
3. Restart: `npm run dev`

### Issue: Error only happens on specific pages

**Solution:**
- Check if it's a Monday.com API error (needs `MONDAY_API_TOKEN`)
- Check if it's a Xero API error (needs Xero credentials)
- Check browser console for which API is failing

### Issue: Works locally but not in production

**Solution:**
- Verify environment variables are set in Vercel
- Make sure they're enabled for Production environment
- Redeploy after adding/updating variables

