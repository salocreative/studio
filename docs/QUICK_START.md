# Quick Start Guide - Monday.com Setup

## Step 1: Get Your API Token (5 minutes)

1. Log in to Monday.com
2. Click your profile → **Admin** → **API**
3. Copy your API token (or generate a new one)
4. Add to `.env.local`:
   ```
   MONDAY_API_TOKEN=your_token_here
   ```

## Step 2: Run Your First Sync

1. Start your dev server: `npm run dev`
2. Log in as an admin user
3. Go to **Settings** → **Sync Settings**
4. Click **"Sync Now"**
5. Check the **Projects** page - you should see your Monday.com projects!

## Step 3: Configure Column Mappings (Optional but Recommended)

The sync will try to auto-detect columns, but for accuracy:

1. Go to **Settings** → **Monday.com Column Mappings**
2. Find your column IDs (see `FINDING_MONDAY_COLUMN_IDS.md`)
3. Map:
   - **Client Column**: Where client names are stored
   - **Quoted Hours Column**: Where quoted/planned hours are stored
   - **Timeline Column**: Where timeline dates are stored

## What Gets Synced?

✅ **Projects** (main items from Monday boards)
- Name
- Client name (if mapped)
- Quoted hours (if mapped)
- Board ID
- Status (active/archived/locked)

✅ **Tasks** (subitems/subtasks)
- Name
- Assigned users
- Quoted hours
- Timeline (start/end dates)
- Parent project relationship

## Troubleshooting

**No projects showing?**
- Check your API token is correct in `.env.local`
- Restart your dev server after adding the token
- Check browser console for errors

**Columns not mapping?**
- See `FINDING_MONDAY_COLUMN_IDS.md` for help finding column IDs
- The sync will still work, but some data might not be extracted correctly

**Projects marked as "locked"?**
- This happens when projects are moved to archived boards
- Locked projects can't have new time entries added
- You can still view historical time entries

## Next Steps

- Set up your users and assign roles in Supabase
- Configure automatic syncing (coming soon)
- Start tracking time against your projects!

