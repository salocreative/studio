# Invitation Link Redirect Fix

## The Issue

The invitation link from Supabase redirects directly to the Site URL (`https://admin.salo.uk`) instead of going through our callback route. When users click the invitation link, they see "Invalid Link" because they aren't authenticated.

## The Invitation Link Format

The invitation link looks like:
```
https://hlmfxwgbmrlmaueyyskn.supabase.co/auth/v1/verify?token=...&type=invite&redirect_to=https://admin.salo.uk
```

When Supabase verifies the invitation, it redirects to the `redirect_to` URL. However, Supabase uses the **Site URL** as the default `redirect_to` value, not our callback route.

## The Solution

We've updated the **middleware** to intercept requests to the root path (`/`) that have a `code` parameter from Supabase. When detected, it redirects to our callback route which handles authentication and then redirects to the password setup page.

### How It Works Now

1. User clicks invitation link → Goes to Supabase verify endpoint
2. Supabase verifies → Redirects to `https://admin.salo.uk/?code=...&type=invite`
3. Middleware intercepts → Detects `code` parameter at root path
4. Redirects to callback → `/auth/callback?code=...&type=invite&redirect=/auth/reset-password`
5. Callback route → Authenticates user, redirects to password setup
6. Password setup → User sets password

## Changes Made

1. **Updated `middleware.ts`**: Added logic to check for `code` parameter at root path and redirect to callback route
2. **Simplified `app/page.tsx`**: Removed unnecessary code since middleware now handles it

## Testing

To test the fix:

1. Invite a test user
2. Click the invitation link from the email
3. The user should be redirected through:
   - Root path (with code) → Callback route → Password setup page
4. Check server logs for "Auth callback - URL params" to verify the flow

## Alternative Solution (Not Recommended)

If the middleware approach doesn't work, you can change the Site URL in Supabase to point directly to the callback route:
- Current: `https://admin.salo.uk`
- Alternative: `https://admin.salo.uk/auth/callback`

However, this might break other redirects, so the middleware approach is preferred.

## Troubleshooting

If users still see "Invalid Link":

1. Check server logs to see if the callback route is being called
2. Verify the middleware is intercepting the root path with code parameter
3. Check browser network tab to see the redirect chain
4. Verify Supabase redirect URLs include the callback route

