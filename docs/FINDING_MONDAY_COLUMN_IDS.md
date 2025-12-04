# Finding Monday.com Column IDs

To configure column mappings in Studio, you'll need to find the column IDs from Monday.com. Here are a few methods:

## Method 1: Using Monday.com API Explorer

1. Go to https://YOUR_ACCOUNT.monday.com/apps
2. Search for "API" and open the API app
3. Use this query to see all column IDs for a board:

```graphql
query {
  boards(ids: [YOUR_BOARD_ID]) {
    id
    name
    columns {
      id
      title
      type
    }
  }
}
```

The `id` field in the response is what you'll use for column mapping.

## Method 2: From the Sync Response

After running a sync, check the `monday_data` field in your Supabase database. It contains all column values with their IDs.

## Method 3: Inspect Network Requests

1. Open your Monday.com board in a browser
2. Open Developer Tools (F12) → Network tab
3. Filter by "graphql" or "v2"
4. Look at the API requests - column IDs are visible in the responses

## Common Column Types

- `text` - Text columns
- `numbers` - Number columns (often used for quoted hours)
- `status` - Status columns
- `timeline` - Timeline/date range columns
- `people` - People/assignee columns
- `formula` - Formula columns

## Example: Finding Client Column ID

If your board has a column named "Client":

1. Use the API query above
2. Find the column with `title: "Client"`
3. Note its `id` (might look like `text`, `text1`, `person`, etc.)
4. Use this ID in the Studio Settings → Column Mappings

## Auto-Detection

The sync function will attempt to auto-detect:
- **Client**: First text column found (if not mapped)
- **Quoted Hours**: First numbers/numeric column found
- **Timeline**: Timeline or date columns

However, for accuracy, it's best to manually map columns in Settings.

