'use client'

import { useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { AlertTriangle, Trash2, Loader2 } from 'lucide-react'
import { SyncButton } from './sync-button'
import { ColumnMappingForm } from './column-mapping-form'
import { CompletedBoardsForm } from './completed-boards-form'
import { LeadsBoardForm } from './leads-board-form'
import { XeroConnectionForm } from './xero-connection-form'
import { deleteAllMondayData } from '@/app/actions/monday'
import { toast } from 'sonner'

export default function SettingsPage() {
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const [deleteConfirmText, setDeleteConfirmText] = useState('')
  const [isDeleting, setIsDeleting] = useState(false)

  const handleDeleteAll = async () => {
    if (deleteConfirmText !== 'DELETE') {
      toast.error('Please type DELETE to confirm')
      return
    }

    setIsDeleting(true)
    try {
      const result = await deleteAllMondayData()
      if (result.error) {
        toast.error(result.error)
      } else {
        toast.success(result.message || 'All Monday.com data deleted successfully')
        setShowDeleteDialog(false)
        setDeleteConfirmText('')
      }
    } catch (error) {
      toast.error('Failed to delete Monday.com data')
      console.error('Error deleting Monday.com data:', error)
    } finally {
      setIsDeleting(false)
    }
  }

  return (
    <div className="flex flex-col h-full">
      <div className="border-b bg-background">
        <div className="flex h-16 items-center px-6">
          <div>
            <h1 className="text-2xl font-semibold">Settings</h1>
            <p className="text-sm text-muted-foreground">
              Configure Monday.com column mappings
            </p>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-4xl space-y-8">
          {/* Sync Settings Section */}
          <div className="space-y-4">
            <div>
              <h2 className="text-xl font-semibold">Sync Settings</h2>
              <p className="text-sm text-muted-foreground">
                Manage synchronization of projects and tasks from Monday.com
              </p>
            </div>
            <Card>
              <CardHeader>
                <CardTitle>Sync Configuration</CardTitle>
                <CardDescription>
                  Control how and when projects and tasks are synchronized from Monday.com
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium">Manual Sync</p>
                    <p className="text-sm text-muted-foreground">
                      Manually trigger a sync from Monday.com
                    </p>
                  </div>
                  <SyncButton />
                </div>

                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium">Automatic Sync</p>
                    <p className="text-sm text-muted-foreground">
                      Automatically sync projects and tasks on a schedule
                    </p>
                  </div>
                  <Button variant="outline">Configure</Button>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Monday.com Integration Section */}
          <div className="space-y-4">
            <div>
              <h2 className="text-xl font-semibold">Monday.com Integration</h2>
              <p className="text-sm text-muted-foreground">
                Configure how Studio connects to and interprets data from Monday.com
              </p>
            </div>
            
            <Card>
              <CardHeader>
                <CardTitle>Column Mappings</CardTitle>
                <CardDescription>
                  Map Monday.com columns to Studio fields. This allows the system to correctly
                  identify client names, quoted hours, and timeline information.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ColumnMappingForm />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Completed Boards</CardTitle>
                <CardDescription>
                  Configure which Monday.com boards contain completed projects. Projects moved to these boards will be archived instead of deleted, preserving time tracking data.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <CompletedBoardsForm />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Leads Board</CardTitle>
                <CardDescription>
                  Configure the Monday.com board that contains lead/prospect projects. These projects will be used for forecasting and resource planning to show future capacity.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <LeadsBoardForm />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>API Configuration</CardTitle>
                <CardDescription>
                  Configure your Monday.com API credentials for server-side integration
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="monday-api-token">API Token</Label>
                  <Input
                    id="monday-api-token"
                    type="password"
                    placeholder="Enter Monday.com API token"
                  />
                  <p className="text-xs text-muted-foreground">
                    This token is stored securely and used server-side only
                  </p>
                </div>

                <div className="flex justify-end">
                  <Button>Save Configuration</Button>
                </div>
              </CardContent>
            </Card>

            <Card className="border-destructive">
              <CardHeader>
                <CardTitle className="text-destructive">Danger Zone</CardTitle>
                <CardDescription>
                  Permanently delete all Monday.com projects and tasks from the database
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4">
                  <div className="flex items-start gap-3">
                    <AlertTriangle className="h-5 w-5 text-destructive mt-0.5" />
                    <div className="flex-1 space-y-2">
                      <p className="text-sm font-medium text-destructive">
                        Delete All Monday.com Data
                      </p>
                      <p className="text-sm text-muted-foreground">
                        This will permanently delete all synced projects and tasks from Monday.com.
                        This action cannot be undone. Time entries linked to these projects will prevent deletion.
                      </p>
                    </div>
                  </div>
                </div>

                <div className="flex justify-end">
                  <Button
                    variant="destructive"
                    onClick={() => setShowDeleteDialog(true)}
                  >
                    <Trash2 className="mr-2 h-4 w-4" />
                    Delete All Monday.com Data
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Xero Integration Section */}
          <div className="space-y-4">
            <div>
              <h2 className="text-xl font-semibold">Xero Integration</h2>
              <p className="text-sm text-muted-foreground">
                Connect your Xero account to import financial data for forecasting and planning
              </p>
            </div>
            <Card>
              <CardHeader>
                <CardTitle>Xero Connection</CardTitle>
                <CardDescription>
                  Connect your Xero accounting account to automatically import revenue, expenses,
                  and profit data. This data will be used for financial forecasting on the Forecast page.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <XeroConnectionForm />
              </CardContent>
            </Card>
          </div>

          {/* User Management Section */}
          <div className="space-y-4">
            <div>
              <h2 className="text-xl font-semibold">Team Management</h2>
              <p className="text-sm text-muted-foreground">
                Add team members and manage their roles and access
              </p>
            </div>
            <Card>
              <CardHeader>
                <CardTitle>User Management</CardTitle>
                <CardDescription>
                  Manage team members, roles, and permissions
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button asChild>
                  <a href="/settings/users">Manage Team Members</a>
                </Button>
              </CardContent>
            </Card>
          </div>

        </div>
      </div>

      {/* Delete Confirmation Dialog */}
      <Dialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-destructive">Delete All Monday.com Data</DialogTitle>
            <DialogDescription>
              This action cannot be undone. This will permanently delete all projects and tasks synced from Monday.com.
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4 py-4">
            <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4">
              <div className="flex items-start gap-3">
                <AlertTriangle className="h-5 w-5 text-destructive mt-0.5" />
                <div className="space-y-2">
                  <p className="text-sm font-medium text-destructive">
                    Warning: This action is permanent
                  </p>
                  <ul className="text-sm text-muted-foreground space-y-1 list-disc list-inside">
                    <li>All synced projects will be deleted</li>
                    <li>All synced tasks will be deleted</li>
                    <li>This will not delete time entries (they will remain but be orphaned)</li>
                    <li>This will not affect your Monday.com account</li>
                  </ul>
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="confirm-delete">
                Type <span className="font-mono font-bold">DELETE</span> to confirm
              </Label>
              <Input
                id="confirm-delete"
                value={deleteConfirmText}
                onChange={(e) => setDeleteConfirmText(e.target.value)}
                placeholder="DELETE"
                disabled={isDeleting}
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setShowDeleteDialog(false)
                setDeleteConfirmText('')
              }}
              disabled={isDeleting}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDeleteAll}
              disabled={isDeleting || deleteConfirmText !== 'DELETE'}
            >
              {isDeleting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Deleting...
                </>
              ) : (
                <>
                  <Trash2 className="mr-2 h-4 w-4" />
                  Delete All Data
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

