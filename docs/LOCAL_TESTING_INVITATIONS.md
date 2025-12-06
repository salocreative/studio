# Testing Invitations Locally

## Yes, It Works Locally! ✅

The invitation link fix works locally for testing. Here's what you need to configure:

## Local Setup Requirements

### 1. Environment Variable

Make sure `NEXT_PUBLIC_SITE_URL` is set in your `.env.local`:

```env
NEXT_PUBLIC_SITE_URL=http://localhost:3000
```

### 2. Supabase Configuration

For local testing, you need to configure Supabase:

1. **Go to Supabase Dashboard** → **Authentication** → **URL Configuration**
2. **Set Site URL** to: `http://localhost:3000`
3. **Add Redirect URLs**:
   - `http://localhost:3000/auth/callback`

### 3. How It Works Locally

When you invite a user locally:

1. **Invitation email sent** → Contains link pointing to your Supabase project
2. **User clicks link** → Goes to Supabase verify endpoint
3. **Supabase verifies** → Redirects to `http://localhost:3000/?code=...&type=invite`
4. **Middleware intercepts** → Detects `code` parameter at root path
5. **Redirects to callback** → `/auth/callback?code=...&type=invite&redirect=/auth/reset-password`
6. **Callback route** → Authenticates user, redirects to password setup
7. **Password setup** → User sets password

## Testing Steps

1. **Start your dev server**:
   ```bash
   npm run dev
   ```

2. **Invite a test user** via the admin panel (use a real email you can access)

3. **Check the invitation email** - the link should point to your Supabase project

4. **Click the link** - it should:
   - Redirect through Supabase
   - Land on `http://localhost:3000/?code=...`
   - Middleware redirects to callback
   - User ends up at password setup page

5. **Check server logs** - you should see:
   ```
   Auth callback - URL params: { code: 'present', type: 'invite', ... }
   ```

## Troubleshooting Local Testing

### Issue: Link redirects to production URL

**Solution**: Check that Supabase Site URL is set to `http://localhost:3000`, not production URL

### Issue: "Invalid Link" error

**Solution**: 
- Verify `NEXT_PUBLIC_SITE_URL=http://localhost:3000` in `.env.local`
- Check that `/auth/callback` is in Supabase redirect URLs
- Restart your dev server after changing `.env.local`

### Issue: Callback route not being called

**Solution**:
- Check server logs for middleware redirects
- Verify the invitation link includes `redirect_to=http://localhost:3000`
- Check browser network tab to see redirect chain

## Local vs Production

| Setting | Local | Production |
|---------|-------|------------|
| Site URL | `http://localhost:3000` | `https://admin.salo.uk` |
| Redirect URLs | `http://localhost:3000/auth/callback` | `https://admin.salo.uk/auth/callback` |
| NEXT_PUBLIC_SITE_URL | `http://localhost:3000` | `https://admin.salo.uk` |

## Recommendation

**Test locally first!** It's faster and easier to debug. Once it works locally, push to git and test on production to make sure the configuration is correct there too.

