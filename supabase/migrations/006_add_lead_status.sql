-- Add 'lead' status to project_status enum
-- This allows projects from the leads board to be tracked separately
alter type project_status add value if not exists 'lead';

