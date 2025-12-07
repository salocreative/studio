-- Rename 'employee' role to 'manager' in the user_role enum
-- This is a two-step process since PostgreSQL doesn't allow renaming enum values directly

-- Step 1: Add 'manager' to the enum
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'manager';

-- Step 2: Update all existing 'employee' records to 'manager'
UPDATE public.users SET role = 'manager'::user_role WHERE role = 'employee'::user_role;

-- Step 3: Update the default value for the role column
ALTER TABLE public.users ALTER COLUMN role SET DEFAULT 'manager'::user_role;

-- Note: We cannot remove 'employee' from the enum as PostgreSQL doesn't support it
-- But we can ensure all new records use 'manager' going forward

