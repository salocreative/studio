# Vercel Deployment Guide

## Prerequisites

Before deploying to Vercel, make sure you have:
1. A Supabase project set up
2. A Vercel account
3. Your repository pushed to GitHub

## Setting Up Environment Variables in Vercel

The Studio application requires Supabase environment variables to work. Follow these steps:

### Step 1: Get Your Supabase Credentials

1. Go to your [Supabase Dashboard](https://supabase.com/dashboard)
2. Select your project
3. Navigate to **Settings** → **API**
4. Copy the following values:
   - **Project URL** (this is your `NEXT_PUBLIC_SUPABASE_URL`)
   - **anon/public key** (this is your `NEXT_PUBLIC_SUPABASE_ANON_KEY`)
   - **service_role key** (this is your `SUPABASE_SERVICE_ROLE_KEY` - scroll down to find it)
     - ⚠️ **Important:** The service role key has full access to your database. Keep it secret and never expose it to the client.
     - This key is only used server-side for admin operations like creating/deleting users

### Step 2: Add Environment Variables to Vercel

1. Go to your [Vercel Dashboard](https://vercel.com/dashboard)
2. Select your project (or create a new one)
3. Go to **Settings** → **Environment Variables**
4. Add the following variables:

   **Required Variables:**

   **Variable 1:**
   - **Name:** `NEXT_PUBLIC_SUPABASE_URL`
   - **Value:** Your Supabase project URL (e.g., `https://your-project-ref.supabase.co`)
   - **Environment:** Select all (Production, Preview, Development)
   - Click **Save**

   **Variable 2:**
   - **Name:** `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - **Value:** Your Supabase anon/public key
   - **Environment:** Select all (Production, Preview, Development)
   - Click **Save**

   **Optional (but recommended for user management):**

   **Variable 3:**
   - **Name:** `SUPABASE_SERVICE_ROLE_KEY`
   - **Value:** Your Supabase service role key (⚠️ Keep this secret!)
   - **Environment:** ⚠️ **CRITICAL:** Make sure to select **Production** (and Preview/Development if needed)
   - Click **Save**
   - **⚠️ Important:** This key should NEVER be exposed to the client. It's only used server-side for admin operations like creating/deleting users.

5. **VERIFY the environment variables are saved:**
   - After adding each variable, verify it appears in the list
   - Make sure `SUPABASE_SERVICE_ROLE_KEY` shows in the Production column ✅
   - If it only shows for Preview/Development, click on it and edit to add Production

6. **Redeploy your application:**
   - Go to **Deployments** tab
   - Click **⋯** on the latest deployment
   - Select **Redeploy** (or push a new commit)
   - ⚠️ **Important:** Environment variable changes require a redeploy to take effect

### Step 3: Configure Custom Domain (Optional)

If you want to use a custom domain (e.g., `admin.salo.uk`):

1. **In Vercel Dashboard:**
   - Go to your project → **Settings** → **Domains**
   - Click **Add Domain**
   - Enter your domain: `admin.salo.uk`
   - Click **Add**

2. **Configure DNS Records:**
   - Vercel will provide DNS records you need to add
   - Go to your domain registrar (where you manage `salo.uk`)
   - Add a CNAME record:
     - **Type:** CNAME
     - **Name/Host:** `admin`
     - **Value/Target:** `cname.vercel-dns.com` (or the value Vercel provides)
     - **TTL:** 3600 (or default)

   Alternatively, if Vercel provides A records, use those instead.

3. **Wait for DNS propagation:**
   - DNS changes can take a few minutes to 48 hours
   - Vercel will show when the domain is configured correctly
   - Once verified, you can set it as the primary domain

4. **Set as Primary Domain:**
   - In Vercel → **Settings** → **Domains**
   - Find `admin.salo.uk`
   - Click the **⋯** menu
   - Select **Set as Primary Domain**

### Step 4: Configure Supabase for Production

1. Go back to your Supabase Dashboard
2. Navigate to **Authentication** → **URL Configuration**
3. Add your production URLs:
   - **Site URL**: `https://admin.salo.uk` (or your custom domain)
   - **Redirect URLs**: 
     - `https://admin.salo.uk/auth/callback`
     - `https://admin.salo.uk/**`
     - If you still want to support the Vercel domain:
       - `https://your-app.vercel.app/auth/callback`
       - `https://*.vercel.app/auth/callback` (wildcard for preview URLs)

### Step 4: Redeploy

After adding environment variables:
1. Go to your Vercel project → **Deployments**
2. Click the **⋯** menu on the latest deployment
3. Select **Redeploy**
4. Or push a new commit to trigger a new deployment

## Optional: Monday.com Integration

If you want to use the Monday.com integration:

1. Get your Monday.com API token from [Monday.com Developer Settings](https://monday.com/monday-api)
2. Add to Vercel Environment Variables:
   ```
   MONDAY_API_TOKEN=your-monday-api-token-here
   ```

## Troubleshooting

**"Missing Supabase environment variables" error:**
- Verify environment variables are set in Vercel Project Settings → Environment Variables
- Make sure they're enabled for the correct environments (Production/Preview/Development)
- Redeploy after adding/updating environment variables

**CORS errors in production:**
- Check Supabase URL Configuration includes your production domain
- Make sure the Site URL matches your Vercel domain

**Authentication not working:**
- Verify redirect URLs are configured in Supabase
- Check that environment variables are correctly set in Vercel
- Ensure the Supabase project is active and not paused

**"Admin API not available" error when adding users:**
- ⚠️ **Most common issue:** `SUPABASE_SERVICE_ROLE_KEY` is not set or not enabled for Production environment
- Go to Vercel → **Settings** → **Environment Variables**
- Verify `SUPABASE_SERVICE_ROLE_KEY` exists and has ✅ in the **Production** column
- If it's missing from Production:
  1. Click on the variable
  2. Make sure **Production** is checked
  3. Click **Save**
  4. **Redeploy** your application (environment variables require redeploy)
- Double-check the value is correct (no extra spaces, complete key)
- Get the service role key from Supabase Dashboard → **Settings** → **API** → **service_role key**
- After fixing, **always redeploy** - changes don't take effect until next deployment

## Verifying Environment Variables

After deployment, you can verify environment variables are set correctly by:
1. Going to Vercel → Your Project → Settings → Environment Variables
2. Checking that all three variables are present:
   - `NEXT_PUBLIC_SUPABASE_URL` ✅ Production
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY` ✅ Production
   - `SUPABASE_SERVICE_ROLE_KEY` ✅ Production (required for user management)
3. Ensuring they're enabled for all environments you're using

**To check if environment variables are actually loaded in production:**
1. Go to Vercel → Your Project → Deployments
2. Click on the latest deployment
3. Click on the **Functions** tab
4. Find a function execution that failed (or check server logs)
5. Look for the diagnostic logs I added - they'll show whether the variables are loaded

**Quick Fix Steps:**
1. **Double-check the variable name:** It must be exactly `SUPABASE_SERVICE_ROLE_KEY` (case-sensitive, no typos)
2. **Verify Production is checked:** In Vercel, when editing the variable, ensure **Production** is selected
3. **Check the value:** Make sure there are no leading/trailing spaces when you paste the key
4. **Redeploy after adding:** Environment variables only take effect on the next deployment
   - Either push a new commit, or
   - Go to Deployments → Click ⋯ on latest → Redeploy

