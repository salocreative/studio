-- Set default role to manager (run after 039 so the enum value is committed).
ALTER TABLE public.users ALTER COLUMN role SET DEFAULT 'manager'::user_role;
