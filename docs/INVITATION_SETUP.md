# Invitation Setup Guide

## Issue: Invitation links redirect to login instead of password setup

When you invite a user, they should be redirected to the password setup page. If they're going straight to the login page, follow these steps:

## Configuration Steps

### 1. Configure Supabase Redirect URLs

The invitation link needs to be in Supabase's allowed redirect URLs:

1. Go to Supabase Dashboard → **Authentication** → **URL Configuration**
2. Under **Redirect URLs**, add:
   - `http://localhost:3000/auth/callback` (for local development)
   - `https://admin.salo.uk/auth/callback` (for production)
   - `https://your-vercel-url.vercel.app/auth/callback` (if using Vercel)
3. Click **Save**

### 2. Verify Site URL

Make sure the **Site URL** is set correctly:
- Local: `http://localhost:3000`
- Production: `https://admin.salo.uk` (or your custom domain)

### 3. Check Environment Variables

Ensure `NEXT_PUBLIC_SITE_URL` is set in your environment:
- Local: `http://localhost:3000`
- Production: `https://admin.salo.uk`

## How Invitation Flow Works

1. Admin creates user → Invitation email is sent
2. User clicks link → Goes to Supabase auth endpoint
3. Supabase verifies → Redirects to `/auth/callback?type=invite&redirect=/auth/reset-password`
4. Callback route detects invitation → Redirects to `/auth/reset-password?type=invite`
5. User sets password → Can now log in

## Troubleshooting

**Invitation link goes to login page:**
- Check that `/auth/callback` is in Supabase's allowed redirect URLs
- Verify the `redirectTo` URL in the invitation includes the callback route
- Check server logs for callback route errors

**User can't set password:**
- Check that user is authenticated (they should be after clicking invitation link)
- Verify the reset password page is accessible
- Check browser console for errors

## Manual Testing

To test if the callback route is working:

1. Invite a test user
2. Check the server logs when they click the invitation link
3. Look for "Auth callback - URL params" logs
4. Check if the user is redirected to password setup

If the callback route isn't being called at all, the redirect URL isn't configured correctly in Supabase.

