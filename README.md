# Studio - Salo Creative

Business management platform for Salo Creative Agency.

## Features

- **Time Tracking**: Simple time entry system (1h, 3h, 6h, or custom) against Monday.com projects
- **Projects**: View all active projects with time tracking status
- **Role-based Access**: Control what employees see based on their role (admin, designer, employee)
- **Monday.com Integration**: Server-side sync with Monday.com for projects and tasks
- **Project Locking**: Lock projects when moved between boards (no new time entries, but available for reporting)

## Tech Stack

- **Framework**: Next.js 16 (App Router)
- **UI**: Shadcn UI components
- **Database**: Supabase (PostgreSQL)
- **Styling**: Tailwind CSS v4
- **Font**: Stolzl (Adobe Fonts)
- **Primary Color**: #6405FF

## Getting Started

1. Install dependencies:
```bash
npm install
```

2. Set up environment variables:
```bash
cp .env.local.example .env.local
```

Fill in your Supabase and Monday.com credentials.

3. Set up Supabase database:
- Create a new Supabase project
- Run the SQL migrations from `supabase/migrations/001_initial_schema.sql`

4. Run the development server:
```bash
npm run dev
```

## Project Structure

```
├── app/
│   ├── (dashboard)/          # Dashboard routes with layout
│   │   ├── time-tracking/    # Time tracking page
│   │   ├── projects/         # Projects page
│   │   ├── forecast/         # Forecast (placeholder)
│   │   ├── scorecard/        # Scorecard (placeholder)
│   │   ├── customers/        # Customers (placeholder)
│   │   └── settings/         # Settings page
│   ├── layout.tsx            # Root layout
│   └── page.tsx              # Home page (redirects to time-tracking)
├── components/
│   ├── navigation/           # Sidebar and layout components
│   └── ui/                   # Shadcn UI components
├── lib/
│   ├── supabase/             # Supabase client utilities
│   └── monday/               # Monday.com API integration
├── types/
│   └── database.ts           # Database type definitions
└── supabase/
    └── migrations/           # Database migrations
```

## Monday.com Integration

The Monday.com integration is designed to be server-side only for future iOS app support. API calls should be made through:
- Server Actions
- API Routes
- Background jobs/webhooks

The integration syncs:
- Projects (items from Monday boards)
- Tasks (subtasks)
- Client names
- Quoted hours
- Timeline information
- Assigned users

## Role-Based Access

- **Admin**: Full access to all features including Settings, Scorecard, and Customers
- **Designer**: Access to Time Tracking, Projects, and Forecast (no Scorecard or Customers)
- **Employee**: Access to Time Tracking, Projects, and Forecast

## Database Schema

Key tables:
- `users`: Extended user profiles with roles
- `monday_projects`: Synced projects from Monday.com
- `monday_tasks`: Tasks/subtasks for projects
- `time_entries`: Time logged by users
- `favorite_tasks`: User's favorite tasks
- `monday_column_mappings`: Admin configuration for Monday.com column mappings

## Next Steps

1. Implement Monday.com API sync logic
2. Complete Time Tracking UI (project selection, favorites, search)
3. Add authentication/login flow
4. Build out Forecast, Scorecard, and Customers sections
5. Add project locking logic when projects move between boards
