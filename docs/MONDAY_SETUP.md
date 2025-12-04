# Monday.com Integration Setup Guide

## Step 1: Get Your Monday.com API Token

1. Log in to your Monday.com account
2. Click on your profile picture (bottom left)
3. Go to **Admin** → **API** (or visit: https://YOUR_ACCOUNT.monday.com/admin/integrations/api)
4. Under **Developer tools**, find **API Token**
5. Click **Generate** or copy your existing token
6. **Important**: Keep this token secure! It provides full access to your Monday.com account.

## Step 2: Set Environment Variable

Add your Monday.com API token to your `.env.local` file:

```env
MONDAY_API_TOKEN=your_monday_api_token_here
```

**Security Note**: This token is server-side only and never exposed to the client.

## Step 3: Understand Monday.com Board Structure

Your Monday.com setup should have:
- **Main Board**: Contains projects (main items)
  - Each project should have a **Client** column
  - Projects can have **subtasks** (child items)
- **Subtask Items**: The tasks within each project
  - These are what employees log time against
  - They should have assigned users
  - They should have quoted hours (if available)
  - They should have timeline information

## Step 4: Map Your Monday.com Columns

In the Studio Settings page, you'll need to map:
- **Client Column**: The column in your main project board that contains the client name
- **Quoted Hours Column**: The column that contains quoted/planned hours
- **Timeline Column**: The column that contains timeline/date range information

## Step 5: Test the Integration

1. Go to Settings → Sync Settings
2. Click "Sync Now"
3. Check your Projects page to see if projects appear

## How the Sync Works

1. **Fetches Boards**: Gets all boards from Monday.com
2. **Fetches Projects**: Gets all items (projects) from your active boards
3. **Fetches Tasks**: Gets all subtasks for each project
4. **Syncs to Supabase**: Creates/updates projects and tasks in your database
5. **Handles Locking**: If a project moves to an archived board, it's marked as "locked"

## Project Locking

When a project is moved from an active board to an archived/completed board:
- The project status is set to `locked`
- No new time entries can be logged against locked projects
- Existing time entries remain visible for reporting

## Troubleshooting

**No projects syncing?**
- Check that your API token is correct
- Verify the token has access to the boards you want to sync
- Check browser console and server logs for errors

**Columns not mapping correctly?**
- Use the Monday.com API explorer to find your column IDs
- Column IDs can be found in the column_values response
- They're usually in format: `text`, `numbers`, `status`, etc.

