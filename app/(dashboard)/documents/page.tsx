import { DocumentsPageContent } from './documents-client'

export default function DocumentsPage() {
  // All authenticated users can view documents, but only admins can upload/edit
  // This is handled by the server actions
  return <DocumentsPageContent />
}

