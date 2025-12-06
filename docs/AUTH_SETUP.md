# Authentication Setup Guide

## Overview

Studio uses Supabase Auth with support for:
- Email/Password authentication
- Google SSO (OAuth)

All routes are protected - users must authenticate to access the dashboard.

## Setting Up Google SSO

### Google OAuth Setup

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select existing
3. Enable Google+ API
4. Go to **Credentials** → **Create Credentials** → **OAuth 2.0 Client ID**
5. Configure OAuth consent screen:
   - Choose "External" (unless you have a Google Workspace)
   - Fill in required information (App name, User support email, Developer contact)
6. Add authorized redirect URIs:
   - `https://YOUR_PROJECT_REF.supabase.co/auth/v1/callback`
   - Add both `http://localhost:3000/auth/callback` for local development
7. Copy Client ID and Client Secret
8. In Supabase Dashboard → **Authentication** → **Providers** → **Google**
9. Enable Google provider and paste credentials
10. Click "Save"

## Environment Variables

Make sure your `.env.local` has:

```env
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key
```

## Creating Your First Admin User

Since the app is now protected, you need to create your first admin user:

### Option 1: Via Supabase Dashboard (Recommended)

1. Go to Supabase Dashboard → **Authentication** → **Users**
2. Click **Add User** → **Create new user**
3. Enter email and set a temporary password
4. Go to **Table Editor** → `users` table
5. Insert a row with:
   - `id`: Copy the user ID from Authentication → Users
   - `email`: User's email
   - `full_name`: User's name (optional)
   - `role`: `admin`
   - `created_at`: Current timestamp
   - `updated_at`: Current timestamp
6. User can now log in and change password

### Option 2: Via SQL

```sql
-- First, create auth user via Supabase Dashboard
-- Then run this SQL (replace with actual user_id and email):

INSERT INTO public.users (id, email, full_name, role)
VALUES (
  'user-uuid-from-auth-users',
  'admin@example.com',
  'Admin User',
  'admin'
);
```

### Option 3: Sign Up First, Then Update Role

1. Go to `/auth/login`
2. Use the email/password form (if signup is enabled)
3. After first login, update your role to `admin` in the database

**Important**: You'll need to enable email signup in Supabase:
- Dashboard → **Authentication** → **Providers** → **Email**
- Enable "Enable email confirmations" if desired
- Users can sign up, then you manually update their role

## User Management

Once logged in as admin:

1. Go to **Settings** → **User Management**
2. Click **Manage Team Members**
3. Add team members:
   - Enter email
   - Set role (Admin, Designer, or Employee)
   - User receives invitation email
   - They set their password and can log in

## Role-Based Access

- **Admin**: Full access including Settings, Scorecard, Customers, User Management
- **Designer**: Time Tracking, Projects, Forecast (no Scorecard/Customers)
- **Employee**: Time Tracking, Projects, Forecast

## Troubleshooting

**CORS Error / "Failed to fetch" when logging in?**
This usually happens when your local development URL isn't configured in Supabase:
1. Go to Supabase Dashboard → **Authentication** → **URL Configuration**
2. Under **Site URL**, add: `http://localhost:3000` (or whatever port you're using)
3. Under **Redirect URLs**, add:
   - `http://localhost:3000/auth/callback`
   - `http://localhost:3001/auth/callback` (if using port 3001)
   - Any other local development URLs you use
4. Click **Save**
5. Try logging in again

**Can't log in?**
- Check that user exists in `auth.users` table
- Check that user profile exists in `public.users` table
- Verify role is set correctly
- Verify CORS configuration (see above)

**SSO not working?**
- Verify redirect URIs match exactly in provider settings
- Check Supabase logs for errors
- Ensure provider is enabled in Supabase Dashboard
- Make sure CORS is configured correctly (see above)

**User management not working?**
- Admin functions require Supabase service role key (server-side only)
- Check that you're logged in as admin
- Verify RLS policies allow admin access

