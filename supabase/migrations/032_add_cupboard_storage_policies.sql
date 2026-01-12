-- Storage Policies for Cupboard Bucket
-- These policies control access to files stored in the 'cupboard' storage bucket

-- Policy 1: Allow authenticated users to read/download files
CREATE POLICY "Authenticated users can read cupboard files"
ON storage.objects FOR SELECT
USING (
  bucket_id = 'cupboard' 
  AND auth.role() = 'authenticated'
);

-- Policy 2: Allow admins to upload files
CREATE POLICY "Admins can upload cupboard files"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'cupboard'
  AND EXISTS (
    SELECT 1 FROM public.users
    WHERE id = auth.uid() AND role = 'admin' AND deleted_at IS NULL
  )
);

-- Policy 3: Allow admins to update files
CREATE POLICY "Admins can update cupboard files"
ON storage.objects FOR UPDATE
USING (
  bucket_id = 'cupboard'
  AND EXISTS (
    SELECT 1 FROM public.users
    WHERE id = auth.uid() AND role = 'admin' AND deleted_at IS NULL
  )
);

-- Policy 4: Allow admins to delete files
CREATE POLICY "Admins can delete cupboard files"
ON storage.objects FOR DELETE
USING (
  bucket_id = 'cupboard'
  AND EXISTS (
    SELECT 1 FROM public.users
    WHERE id = auth.uid() AND role = 'admin' AND deleted_at IS NULL
  )
);

