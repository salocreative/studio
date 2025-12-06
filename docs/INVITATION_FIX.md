# Fix "Invalid Link" Error for Invitations

## The Problem

When users click the invitation link from their email, they see "Invalid Link" instead of the password setup page.

## Root Cause

The invitation link isn't routing through the callback route (`/auth/callback`), so users aren't authenticated when they land on the reset-password page.

## Solution

### Step 1: Configure Supabase Redirect URLs

1. Go to [Supabase Dashboard](https://supabase.com/dashboard)
2. Select your project
3. Go to **Authentication** → **URL Configuration**
4. Under **Redirect URLs**, add:
   - `http://localhost:3000/auth/callback` (for local development)
   - `https://admin.salo.uk/auth/callback` (for production)
5. Click **Save**

### Step 2: Verify Site URL

In the same Supabase page, check that the **Site URL** is set correctly:
- Local: `http://localhost:3000`
- Production: `https://admin.salo.uk`

### Step 3: Test the Flow

1. Invite a test user
2. Check your server logs when they click the invitation link
3. You should see logs like:
   ```
   Auth callback - URL params: { code: 'present', type: 'invite', ... }
   ```
4. If you don't see these logs, the callback route isn't being called

### Step 4: Check the Invitation Email Link

1. Open the invitation email
2. Look at the actual link URL
3. It should include `/auth/callback` in the `redirect_to` parameter
4. Example: `https://your-project.supabase.co/auth/v1/verify?token=...&redirect_to=http://localhost:3000/auth/callback?type=invite...`

## What Should Happen

1. User clicks invitation link → Goes to Supabase auth endpoint
2. Supabase authenticates → Redirects to `/auth/callback?code=...&type=invite`
3. Callback route runs → User is authenticated, redirected to `/auth/reset-password?type=invite`
4. Password setup page → User can set their password

## Troubleshooting

**If callback route isn't being called:**
- Double-check that `/auth/callback` is in Supabase's allowed redirect URLs
- Verify the Site URL matches your application URL
- Check that `NEXT_PUBLIC_SITE_URL` is set correctly in your environment

**If user still sees "Invalid Link":**
- Check server logs for callback route errors
- Verify the user is authenticated (check browser console)
- Try clearing browser cache and cookies

## Current Status

The reset-password page has been updated to:
- Check if user is authenticated (even without `type=invite`)
- Allow password setup for authenticated users
- Show better error messages

Once the callback route is configured correctly in Supabase, the invitation flow should work properly.

