import type { SowStatus } from '@/app/actions/sow'

export type ClientApprovalStatus = {
  label: string
  description: string
  tone: 'muted' | 'warning' | 'success' | 'destructive'
}

export function getClientApprovalStatus(
  status: SowStatus,
  details?: {
    approved_by_name?: string | null
    approved_at?: string | null
    rejected_by_name?: string | null
    rejected_at?: string | null
  }
): ClientApprovalStatus {
  switch (status) {
    case 'approved':
      return {
        label: 'Client approved',
        description: details?.approved_by_name
          ? `Approved by ${details.approved_by_name}${
              details.approved_at
                ? ` on ${new Date(details.approved_at).toLocaleDateString()}`
                : ''
            }`
          : 'The client has approved this statement of work',
        tone: 'success',
      }
    case 'rejected':
      return {
        label: 'Client declined',
        description: details?.rejected_by_name
          ? `Declined by ${details.rejected_by_name}${
              details.rejected_at
                ? ` on ${new Date(details.rejected_at).toLocaleDateString()}`
                : ''
            }`
          : 'The client declined this statement of work',
        tone: 'destructive',
      }
    case 'sent':
      return {
        label: 'Awaiting client approval',
        description: 'Share link sent — waiting for the client to approve or decline',
        tone: 'warning',
      }
    case 'archived':
      return {
        label: 'Archived',
        description: 'This statement of work has been archived',
        tone: 'muted',
      }
    default:
      return {
        label: 'Not sent to client',
        description: 'Create a share link to send this SoW for client approval',
        tone: 'muted',
      }
  }
}
