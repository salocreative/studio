'use client'

import { useState, useEffect } from 'react'
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { AlertTriangle, Trash2, Loader2, Plus, Mail } from 'lucide-react'
import { Switch } from '@/components/ui/switch'
import { SyncButton } from './sync-button'
import { ColumnMappingForm } from './column-mapping-form'
import { XeroConnectionForm } from './xero-connection-form'
import { AutomaticSyncForm } from './automatic-sync-form'
import { ScorecardSyncForm } from './scorecard-sync-form'
import { QuoteRatesForm } from './quote-rates-form'
import { QuoteValueDebugger } from './quote-value-debugger'
import { LeadsStatusConfigForm } from './leads-status-config-form'
import { LifetimeValueBracketsForm } from './lifetime-value-brackets-form'
import { deleteAllMondayData } from '@/app/actions/monday'
import { getUsers, createUser, updateUserRole, deleteUser, updateUserUtilizationExclusion } from '@/app/actions/users'
import { toast } from 'sonner'

interface User {
  id: string
  email: string
  full_name: string | null
  role: 'admin' | 'designer' | 'manager'
  exclude_from_utilization?: boolean
  created_at: string
}

export default function SettingsPage() {
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const [deleteConfirmText, setDeleteConfirmText] = useState('')
  const [isDeleting, setIsDeleting] = useState(false)
  
  // Team management state
  const [users, setUsers] = useState<User[]>([])
  const [loadingUsers, setLoadingUsers] = useState(false)
  const [showAddForm, setShowAddForm] = useState(false)
  const [email, setEmail] = useState('')
  const [fullName, setFullName] = useState('')
  const [role, setRole] = useState<'admin' | 'designer' | 'manager'>('manager')
  const [submitting, setSubmitting] = useState(false)

  // Load users on mount
  useEffect(() => {
    loadUsers()
  }, [])

  async function loadUsers() {
    setLoadingUsers(true)
    try {
      const result = await getUsers()
      if (result.error) {
        toast.error(result.error)
      } else if (result.users) {
        setUsers(result.users)
      }
    } catch (error) {
      console.error('Error loading users:', error)
      toast.error('Failed to load users')
    } finally {
      setLoadingUsers(false)
    }
  }

  async function handleCreateUser(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)

    try {
      const result = await createUser(email, fullName || undefined, role)
      if (result.error) {
        toast.error(result.error)
      } else {
        setEmail('')
        setFullName('')
        setRole('manager')
        setShowAddForm(false)
        await loadUsers()
        toast.success('User invitation sent! They will receive an email to set their password.')
      }
    } catch (error) {
      console.error('Error creating user:', error)
      toast.error('An error occurred while creating the user')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleUpdateRole(userId: string, newRole: 'admin' | 'designer' | 'manager') {
    try {
      const result = await updateUserRole(userId, newRole)
      if (result.error) {
        toast.error(result.error)
      } else {
        await loadUsers()
        toast.success('User role updated')
      }
    } catch (error) {
      console.error('Error updating role:', error)
      toast.error('Failed to update user role')
    }
  }

  async function handleDeleteUser(userId: string) {
    if (!confirm('Are you sure you want to remove this user? This action cannot be undone.')) {
      return
    }

    try {
      const result = await deleteUser(userId)
      if (result.error) {
        toast.error(result.error)
      } else {
        await loadUsers()
        toast.success('User removed')
      }
    } catch (error) {
      console.error('Error deleting user:', error)
      toast.error('Failed to remove user')
    }
  }

  async function handleToggleUtilizationExclusion(userId: string, exclude: boolean) {
    try {
      const result = await updateUserUtilizationExclusion(userId, exclude)
      if (result.error) {
        toast.error(result.error)
      } else {
        await loadUsers()
        toast.success(exclude ? 'User excluded from utilization calculations' : 'User included in utilization calculations')
      }
    } catch (error) {
      console.error('Error updating utilization exclusion:', error)
      toast.error('Failed to update utilization exclusion')
    }
  }

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
              Manage your team, data sync, and integrations
            </p>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-4xl">
          <Tabs defaultValue="team" className="w-full">
            <TabsList className="grid w-full max-w-md grid-cols-3">
              <TabsTrigger value="team">Team</TabsTrigger>
              <TabsTrigger value="data-sync">Data Sync</TabsTrigger>
              <TabsTrigger value="integrations">Integrations</TabsTrigger>
            </TabsList>

            {/* Team Tab */}
            <TabsContent value="team" className="mt-6 space-y-6">
              <div className="space-y-4">
                <div>
                  <h2 className="text-xl font-semibold">Team Management</h2>
                  <p className="text-sm text-muted-foreground">
                    Add team members and manage their roles and access
                  </p>
                </div>

                {showAddForm && (
                  <Card>
                    <CardHeader>
                      <CardTitle>Add Team Member</CardTitle>
                      <CardDescription>
                        Invite a new team member. They will receive an email to set their password.
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      <form onSubmit={handleCreateUser} className="space-y-4">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div className="space-y-2">
                            <Label htmlFor="email">Email *</Label>
                            <Input
                              id="email"
                              type="email"
                              placeholder="name@example.com"
                              value={email}
                              onChange={(e) => setEmail(e.target.value)}
                              required
                              disabled={submitting}
                            />
                          </div>

                          <div className="space-y-2">
                            <Label htmlFor="fullName">Full Name</Label>
                            <Input
                              id="fullName"
                              placeholder="John Doe"
                              value={fullName}
                              onChange={(e) => setFullName(e.target.value)}
                              disabled={submitting}
                            />
                          </div>
                        </div>

                        <div className="space-y-2">
                          <Label htmlFor="role">Role</Label>
                          <Select value={role} onValueChange={(value: any) => setRole(value)}>
                            <SelectTrigger id="role">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="admin">Admin</SelectItem>
                              <SelectItem value="designer">Designer</SelectItem>
                              <SelectItem value="manager">Manager</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>

                        <div className="flex justify-end gap-2">
                          <Button
                            type="button"
                            variant="outline"
                            onClick={() => setShowAddForm(false)}
                            disabled={submitting}
                          >
                            Cancel
                          </Button>
                          <Button type="submit" disabled={submitting}>
                            {submitting ? (
                              <>
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                Sending...
                              </>
                            ) : (
                              'Send Invitation'
                            )}
                          </Button>
                        </div>
                      </form>
                    </CardContent>
                  </Card>
                )}

                <Card>
                  <CardHeader className="flex flex-row items-center justify-between">
                    <div>
                      <CardTitle>All Team Members</CardTitle>
                      <CardDescription>
                        Manage roles, exclude from utilization calculations, and remove team members from the platform
                      </CardDescription>
                    </div>
                    <Button onClick={() => setShowAddForm(!showAddForm)}>
                      <Plus className="mr-2 h-4 w-4" />
                      Add Member
                    </Button>
                  </CardHeader>
                  <CardContent>
                    {loadingUsers ? (
                      <div className="flex items-center justify-center py-8">
                        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                      </div>
                    ) : (
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Name</TableHead>
                            <TableHead>Email</TableHead>
                            <TableHead>Role</TableHead>
                            <TableHead>Exclude from Utilization</TableHead>
                            <TableHead>Joined</TableHead>
                            <TableHead className="text-right">Actions</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {users.length === 0 ? (
                            <TableRow>
                              <TableCell colSpan={6} className="text-center text-muted-foreground">
                                No users found
                              </TableCell>
                            </TableRow>
                          ) : (
                            users.map((user) => (
                              <TableRow key={user.id}>
                                <TableCell className="font-medium">
                                  {user.full_name || '—'}
                                </TableCell>
                                <TableCell>
                                  <div className="flex items-center gap-2">
                                    <Mail className="h-4 w-4 text-muted-foreground" />
                                    {user.email}
                                  </div>
                                </TableCell>
                                <TableCell>
                                  <Select
                                    value={user.role}
                                    onValueChange={(value: any) =>
                                      handleUpdateRole(user.id, value)
                                    }
                                  >
                                    <SelectTrigger className="w-32">
                                      <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="admin">Admin</SelectItem>
                                      <SelectItem value="designer">Designer</SelectItem>
                                      <SelectItem value="manager">Manager</SelectItem>
                                    </SelectContent>
                                  </Select>
                                </TableCell>
                                <TableCell>
                                  <div className="flex items-center space-x-2">
                                    <Switch
                                      checked={user.exclude_from_utilization || false}
                                      onCheckedChange={(checked) =>
                                        handleToggleUtilizationExclusion(user.id, checked)
                                      }
                                    />
                                    <span className="text-sm text-muted-foreground">
                                      {user.exclude_from_utilization ? 'Excluded' : 'Included'}
                                    </span>
                                  </div>
                                </TableCell>
                                <TableCell>
                                  {new Date(user.created_at).toLocaleDateString()}
                                </TableCell>
                                <TableCell className="text-right">
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={() => handleDeleteUser(user.id)}
                                  >
                                    <Trash2 className="h-4 w-4 text-destructive" />
                                  </Button>
                                </TableCell>
                              </TableRow>
                            ))
                          )}
                        </TableBody>
                      </Table>
                    )}
                  </CardContent>
                </Card>
              </div>
            </TabsContent>

            {/* Data Sync Tab */}
            <TabsContent value="data-sync" className="mt-6 space-y-6">
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

                    <div className="space-y-4 pt-4 border-t">
                      <AutomaticSyncForm />
                    </div>
                  </CardContent>
                </Card>

                <ScorecardSyncForm />
              </div>

              <div className="space-y-4">
                <div>
                  <h2 className="text-xl font-semibold">Monday.com Configuration</h2>
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
                    <CardTitle>Debug Quote Value Mapping</CardTitle>
                    <CardDescription>
                      Check if quote_value column mappings are configured correctly and if values are being extracted from Monday.com
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <QuoteValueDebugger />
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>Leads Status Configuration</CardTitle>
                    <CardDescription>
                      Configure which lead statuses to include or exclude from Monthly Summary forecasts
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <LeadsStatusConfigForm />
                  </CardContent>
                </Card>

                <LifetimeValueBracketsForm />

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
            </TabsContent>

            {/* Integrations Tab */}
            <TabsContent value="integrations" className="mt-6 space-y-6">
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

              <div className="space-y-4">
                <div>
                  <h2 className="text-xl font-semibold">Quote Rates</h2>
                  <p className="text-sm text-muted-foreground">
                    Configure day rates and hours per day for different customer types used in the Quote calculator
                  </p>
                </div>
                <Card>
                  <CardHeader>
                    <CardTitle>Day Rates</CardTitle>
                    <CardDescription>
                      Set day rates and hours per day for partner and client customer types. These rates are used when building quotes.
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <QuoteRatesForm />
                  </CardContent>
                </Card>
              </div>
            </TabsContent>
          </Tabs>
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

