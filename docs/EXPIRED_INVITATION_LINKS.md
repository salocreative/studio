# Handling Expired Invitation Links

## The Issue

When a Supabase invitation link expires, Supabase redirects to the reset-password page with error parameters in the URL hash:

```
https://admin.salo.uk/auth/reset-password#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired
```

## How It Works

1. **User clicks expired invitation link** → Goes to Supabase verify endpoint
2. **Supabase detects expiration** → Redirects directly to reset-password page with errors in hash
3. **Reset-password page** → Reads error from URL hash and displays appropriate message

## Error Parameters

Supabase passes errors in the URL hash (fragment), not query parameters:
- `error`: The error type (e.g., `access_denied`)
- `error_code`: Specific error code (e.g., `otp_expired`, `token_expired`)
- `error_description`: Human-readable error message

## Solution

The reset-password page now:
1. Reads error parameters from the URL hash (`window.location.hash`)
2. Detects expired links (`error_code === 'otp_expired'` or `'token_expired'`)
3. Displays a clear error message to the user
4. Provides guidance to contact the administrator for a new invitation

## Common Error Codes

- `otp_expired`: One-time password/invitation link has expired
- `token_expired`: Authentication token has expired
- `access_denied`: Access was denied (often accompanies expired links)

## User Experience

When a user clicks an expired invitation link:
1. They see a clear error page: "Link Expired"
2. Error message explains the link is invalid or has expired
3. They're directed to contact their administrator for a new invitation
4. A "Go to Login" button is provided

## Admin Action Required

If an invitation link expires:
1. Go to the Users page in the admin panel
2. Delete the existing user (if needed)
3. Create a new user with the same email
4. A new invitation email will be sent automatically

## Testing

To test expired link handling:
1. Invite a test user
2. Wait for the invitation link to expire (default is 24-48 hours)
3. Click the expired link
4. Verify the error page displays correctly

## Prevention

To prevent expired links:
- Send invitations promptly after creating users
- Remind users to check their email and click links within 24-48 hours
- Consider increasing the invitation expiration time in Supabase settings (if available)

