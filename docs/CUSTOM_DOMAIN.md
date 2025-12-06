# Setting Up Custom Domain (admin.salo.uk)

This guide walks you through setting up `admin.salo.uk` as your primary domain for Studio on Vercel.

## Prerequisites

- Access to your domain registrar (where `salo.uk` is managed)
- Vercel project deployed
- Access to Vercel dashboard

## Step 1: Add Domain in Vercel

1. Go to your [Vercel Dashboard](https://vercel.com/dashboard)
2. Select your **Studio** project
3. Navigate to **Settings** → **Domains**
4. Click **Add Domain**
5. Enter: `admin.salo.uk`
6. Click **Add**

Vercel will now show you the DNS configuration needed.

## Step 2: Configure DNS Records

You have two options depending on what Vercel provides:

### Option A: CNAME Record (Recommended)

1. Go to your domain registrar (e.g., Namecheap, GoDaddy, Cloudflare)
2. Find DNS management for `salo.uk`
3. Add a new CNAME record:
   - **Type:** CNAME
   - **Name/Host:** `admin` (or `admin.salo.uk` depending on your registrar)
   - **Value/Target:** `cname.vercel-dns.com` (or the exact value Vercel shows)
   - **TTL:** 3600 (or leave default)

### Option B: A Records (If Vercel provides them)

1. Vercel may provide A records instead
2. Add those A records to your DNS settings
3. Follow the exact IP addresses Vercel provides

## Step 3: Wait for DNS Propagation

- DNS changes can take anywhere from a few minutes to 48 hours
- Usually it's within 1-2 hours
- Check status in Vercel → **Settings** → **Domains**
- Vercel will show when the domain is **Configured** ✅

## Step 4: Set as Primary Domain

Once the domain is verified:

1. In Vercel → **Settings** → **Domains**
2. Find `admin.salo.uk` in the list
3. Click the **⋯** (three dots) menu next to it
4. Select **Set as Primary Domain**

This makes `admin.salo.uk` the default domain for your project.

## Step 5: Update Supabase Configuration

Update Supabase to allow authentication from your custom domain:

1. Go to [Supabase Dashboard](https://supabase.com/dashboard)
2. Select your project
3. Navigate to **Authentication** → **URL Configuration**
4. Update:
   - **Site URL:** `https://admin.salo.uk`
   - **Redirect URLs:** Add:
     - `https://admin.salo.uk/auth/callback`
     - `https://admin.salo.uk/**`
5. You can keep the Vercel domains as backup:
   - `https://studio-kohl-delta-11.vercel.app/auth/callback`
   - `https://*.vercel.app/auth/callback` (for preview deployments)
6. Click **Save**

## Step 6: Verify Everything Works

1. Visit `https://admin.salo.uk` in your browser
2. Try logging in
3. Verify authentication redirects work correctly
4. Check that cookies are being set correctly

## Troubleshooting

**Domain not resolving?**
- Wait longer for DNS propagation (can take up to 48 hours)
- Double-check DNS records match exactly what Vercel provided
- Use online DNS checkers like [whatsmydns.net](https://www.whatsmydns.net/) to verify propagation

**SSL Certificate issues?**
- Vercel automatically provisions SSL certificates via Let's Encrypt
- This happens automatically once DNS is configured
- Wait a few minutes after DNS is verified for SSL to activate

**Authentication not working?**
- Verify Supabase URL Configuration includes your custom domain
- Check that redirect URLs match exactly (including `https://` and trailing paths)
- Clear browser cookies and try again

**Still seeing Vercel domain?**
- Make sure you set the custom domain as Primary in Vercel
- Clear your browser cache
- Some redirects might need time to propagate

## Multiple Environments

If you want to keep the Vercel domain for preview deployments:

- Keep `https://*.vercel.app/**` in Supabase redirect URLs
- Production will use `admin.salo.uk`
- Preview deployments will still work with `*.vercel.app` domains

