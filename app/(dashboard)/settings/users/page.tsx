'use client'

import { useEffect, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
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
import { Badge } from '@/components/ui/badge'
import { Plus, Mail, Trash2, Loader2 } from 'lucide-react'
import { getUsers, createUser, updateUserRole, deleteUser } from '@/app/actions/users'

interface User {
  id: string
  email: string
  full_name: string | null
  role: 'admin' | 'designer' | 'manager'
  created_at: string
}

export default function UsersPage() {
  const [users, setUsers] = useState<User[]>([])
  const [loading, setLoading] = useState(true)
  const [showAddForm, setShowAddForm] = useState(false)
  const [email, setEmail] = useState('')
  const [fullName, setFullName] = useState('')
  const [role, setRole] = useState<'admin' | 'designer' | 'manager'>('manager')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    loadUsers()
  }, [])

  async function loadUsers() {
    setLoading(true)
    try {
      const result = await getUsers()
      if (result.error) {
        alert(`Error: ${result.error}`)
      } else if (result.users) {
        setUsers(result.users)
      }
    } catch (error) {
      console.error('Error loading users:', error)
    } finally {
      setLoading(false)
    }
  }

  async function handleCreateUser(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)

    try {
      const result = await createUser(email, fullName || undefined, role)
      if (result.error) {
        alert(`Error: ${result.error}`)
      } else {
        setEmail('')
        setFullName('')
        setRole('manager')
        setShowAddForm(false)
        await loadUsers()
        alert('User invitation sent! They will receive an email to set their password.')
      }
    } catch (error) {
      console.error('Error creating user:', error)
      alert('An error occurred while creating the user')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleUpdateRole(userId: string, newRole: 'admin' | 'designer' | 'manager') {
    try {
      const result = await updateUserRole(userId, newRole)
      if (result.error) {
        alert(`Error: ${result.error}`)
      } else {
        await loadUsers()
      }
    } catch (error) {
      console.error('Error updating role:', error)
    }
  }

  async function handleDeleteUser(userId: string) {
    if (!confirm('Are you sure you want to remove this user? This action cannot be undone.')) {
      return
    }

    try {
      const result = await deleteUser(userId)
      if (result.error) {
        alert(`Error: ${result.error}`)
      } else {
        await loadUsers()
      }
    } catch (error) {
      console.error('Error deleting user:', error)
    }
  }

  const getRoleBadgeVariant = (role: string) => {
    switch (role) {
      case 'admin':
        return 'default'
      case 'designer':
        return 'secondary'
      default:
        return 'outline'
    }
  }

  return (
    <div className="flex flex-col h-full">
      <div className="border-b bg-background">
        <div className="flex h-16 items-center justify-between px-6">
          <div>
            <h1 className="text-2xl font-semibold">Team Members</h1>
            <p className="text-sm text-muted-foreground">Manage access and roles</p>
          </div>
          <Button onClick={() => setShowAddForm(!showAddForm)}>
            <Plus className="mr-2 h-4 w-4" />
            Add Member
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-6xl space-y-6">
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
            <CardHeader>
              <CardTitle>All Team Members</CardTitle>
              <CardDescription>
                Manage roles and remove team members from the platform
              </CardDescription>
            </CardHeader>
            <CardContent>
              {loading ? (
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
                      <TableHead>Joined</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {users.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center text-muted-foreground">
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
      </div>
    </div>
  )
}

