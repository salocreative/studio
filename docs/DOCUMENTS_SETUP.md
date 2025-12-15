# Documents Feature Setup Guide

## Overview

The Documents feature allows admins to upload and manage PDF documents (HR and Sales) that are accessible to all employees.

## Database Setup

Run the migration:

```bash
supabase migration up
```

Or manually run the SQL from:
```
supabase/migrations/022_add_documents.sql
```

This creates:
- `documents` table - stores document metadata (title, description, category, file path)
- `document_category` enum - 'hr' or 'sales'
- RLS policies - admins can manage, all authenticated users can read

## Storage Bucket Setup

You need to create a Supabase Storage bucket for documents:

### Step 1: Create the Bucket

1. Go to your Supabase Dashboard
2. Navigate to **Storage**
3. Click **New bucket**
4. Configure:
   - **Name**: `documents`
   - **Public bucket**: ❌ **Unchecked** (private bucket - requires authentication)
   - Click **Create bucket**

### Step 2: Configure Storage Policies

The bucket should use RLS policies. Create the following policies:

#### Policy 1: Allow authenticated users to read files

```sql
-- Allow authenticated users to download/view documents
CREATE POLICY "Authenticated users can read documents"
ON storage.objects FOR SELECT
USING (
  bucket_id = 'documents' 
  AND auth.role() = 'authenticated'
);
```

#### Policy 2: Allow admins to upload files

```sql
-- Allow admins to upload documents
CREATE POLICY "Admins can upload documents"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'documents'
  AND EXISTS (
    SELECT 1 FROM public.users
    WHERE id = auth.uid() AND role = 'admin'
  )
);
```

#### Policy 3: Allow admins to delete files

```sql
-- Allow admins to delete documents
CREATE POLICY "Admins can delete documents"
ON storage.objects FOR DELETE
USING (
  bucket_id = 'documents'
  AND EXISTS (
    SELECT 1 FROM public.users
    WHERE id = auth.uid() AND role = 'admin'
  )
);
```

### Step 3: File Size Limits

By default, Supabase Storage has file size limits. For PDFs, you may want to increase this:

1. Go to **Settings** → **API** in Supabase Dashboard
2. Check the **File size limit** setting
3. Adjust if needed (default is usually 50MB)

## Usage

### Admin Features

1. **Upload Document**:
   - Click "Upload Document" button
   - Select a PDF file
   - Enter title, description, and category
   - Click "Upload"

2. **Edit Document**:
   - Click the edit icon on any document
   - Update title, description, or category
   - Note: File cannot be changed after upload

3. **Delete Document**:
   - Click the delete icon on any document
   - Confirm deletion
   - This will delete both the database record and the file from storage

### Employee Features

1. **View Documents**:
   - Browse all documents or filter by category (HR or Sales)
   - View document title, description, and metadata

2. **Download Documents**:
   - Click "Download" button on any document
   - PDF opens in a new tab/window

## File Storage Structure

Files are stored in the `documents` bucket with the following structure:
```
documents/
  ├── {timestamp}-{random}.pdf
  ├── {timestamp}-{random}.pdf
  └── ...
```

Each file gets a unique name based on timestamp and random string to prevent collisions.

## Security

- **Authentication Required**: All users must be authenticated to view/download documents
- **Admin Only Upload/Edit/Delete**: Only users with `role = 'admin'` can manage documents
- **Private Bucket**: Files are stored in a private bucket (not publicly accessible)
- **Signed URLs**: Downloads use signed URLs that expire after 1 hour

## Troubleshooting

### "Failed to upload file"
- Check that the `documents` storage bucket exists
- Verify storage policies are set up correctly
- Check file size limits
- Ensure user has admin role

### "Failed to generate download URL"
- Check that the file path exists in storage
- Verify the storage bucket is accessible
- Check that user is authenticated

### Documents not appearing
- Check database migration was run
- Verify RLS policies allow authenticated users to read
- Check browser console for errors

