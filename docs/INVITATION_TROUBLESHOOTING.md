# Invitation Link Troubleshooting

## Issue: "Invalid Link" Error When Clicking Invitation Email

If users are seeing "Invalid Link" when clicking the invitation email, this usually means the invitation link isn't properly routing through the callback route to authenticate the user.

## How Invitation Links Should Work

1. **User clicks invitation link** → Goes to Supabase auth endpoint
2. **Supabase authenticates** → Redirects to our callback route (`/auth/callback`)
3. **Callback route** → Exchanges code for session, detects invitation, redirects to password setup
4. **Password setup page** → User sets password

## Common Issues

### Issue 1: Callback Route Not in Supabase Redirect URLs

**Solution:**
1. Go to Supabase Dashboard → **Authentication** → **URL Configuration**
2. Under **Redirect URLs**, ensure you have:
   - `http://localhost:3000/auth/callback` (local)
   - `https://admin.salo.uk/auth/callback` (production)
3. Click **Save**

### Issue 2: Invitation Link Not Using Callback Route

Supabase invitation emails may not always respect the `redirectTo` parameter. The link format is:
```
https://your-project.supabase.co/auth/v1/verify?token=...&type=invite&redirect_to=...
```

**Check:**
- Open the invitation email
- Look at the actual link URL
- Verify it includes your callback route in the `redirect_to` parameter

### Issue 3: User Not Authenticated When Landing on Reset Password Page

If the callback route isn't called, users land on the reset-password page without being authenticated.

**Solution:**
- The reset-password page should check if the user is authenticated
- If authenticated, allow password setup
- If not authenticated, show helpful error message

## Debugging Steps

1. **Check server logs** when user clicks invitation link:
   - Look for "Auth callback - URL params" logs
   - If you don't see these logs, the callback route isn't being called

2. **Check the invitation email link**:
   - Copy the link from the email
   - Check if it includes `/auth/callback` in the URL
   - Verify the redirect URL is correct

3. **Check browser console**:
   - Look for authentication errors
   - Check network requests to see where the user is being redirected

4. **Verify Supabase configuration**:
   - Site URL matches your application URL
   - Redirect URLs include your callback route
   - Email templates are using the correct redirect URL

## Quick Fix

If users are seeing "Invalid Link", they should:
1. Check that they clicked the link from the email (not copied/pasted)
2. Try opening the link in an incognito/private window
3. Contact admin if the issue persists

The callback route has logging enabled, so check your server logs to see what's happening when users click the invitation link.

