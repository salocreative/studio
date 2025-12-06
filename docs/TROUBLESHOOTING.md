# Troubleshooting Guide

## "Invalid API key" Error

If you're seeing an "Invalid API key" error alert, this usually means one of your API keys is invalid or expired.

### Common Causes:

1. **Supabase Anon Key is Invalid/Expired**
   - The key might have been rotated or revoked
   - Check Supabase Dashboard → Settings → API
   - Copy the new `anon` key and update your `.env.local`

2. **Environment Variables Not Loaded**
   - Make sure `.env.local` exists in the project root
   - Restart your dev server after changing environment variables
   - Verify variables are set: `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`

3. **Supabase Client Initialization Failing**
   - Check browser console for more detailed error messages
   - Verify the Supabase URL and key are correct

### How to Fix:

1. **Check your environment variables:**
   ```bash
   # In your project root
   cat .env.local | grep SUPABASE
   ```

2. **Verify keys in Supabase Dashboard:**
   - Go to Supabase Dashboard → Settings → API
   - Copy the `anon` key (public)
   - Update `.env.local`:
     ```
     NEXT_PUBLIC_SUPABASE_ANON_KEY=your_new_key_here
     ```

3. **Restart your dev server:**
   ```bash
   # Stop the server (Ctrl+C)
   # Then restart
   npm run dev
   ```

4. **Clear browser cache and cookies:**
   - Sometimes old session data can cause issues
   - Clear cookies for localhost:3000

### Check Server Logs

When the error occurs, check your terminal/server logs for more details:
- Look for "Error creating Supabase client"
- Check for any authentication errors
- Note the exact error message

### Still Not Working?

1. Verify your Supabase project is active and not paused
2. Check that your IP isn't blocked by Supabase
3. Try creating a new Supabase project and updating the keys
4. Check browser console for network errors when making API calls

