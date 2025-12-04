'use client'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { SyncButton } from './sync-button'
import { ColumnMappingForm } from './column-mapping-form'
import { CompletedBoardsForm } from './completed-boards-form'

export default function SettingsPage() {
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
    </div>
  )
}

