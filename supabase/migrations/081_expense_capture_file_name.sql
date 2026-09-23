-- Original attachment name and email subject so Xero Review can tell an invoice
-- from a statement without opening the file. Amount still lives on expense_captures.

alter table public.expense_captures
  add column if not exists file_name text,
  add column if not exists email_subject text;

comment on column public.expense_captures.file_name is
  'Original attachment or Drive file name, used to label invoice vs statement.';
comment on column public.expense_captures.email_subject is
  'Subject of the captured Gmail message.';
