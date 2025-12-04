'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { 
  Clock, 
  FolderKanban, 
  Calendar, 
  Trophy, 
  Users,
  Settings,
  LogOut
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'

interface NavItem {
  title: string
  href: string
  icon: React.ComponentType<{ className?: string }>
  roles: ('admin' | 'designer' | 'employee')[]
}

const navigation: NavItem[] = [
  {
    title: 'Time Tracking',
    href: '/time-tracking',
    icon: Clock,
    roles: ['admin', 'designer', 'employee'],
  },
  {
    title: 'Projects',
    href: '/projects',
    icon: FolderKanban,
    roles: ['admin', 'designer', 'employee'],
  },
  {
    title: 'Forecast',
    href: '/forecast',
    icon: Calendar,
    roles: ['admin', 'designer', 'employee'],
  },
  {
    title: 'Scorecard',
    href: '/scorecard',
    icon: Trophy,
    roles: ['admin'], // Only admins can see scorecard
  },
  {
    title: 'Customers',
    href: '/customers',
    icon: Users,
    roles: ['admin'], // Only admins can see customers
  },
  {
    title: 'Settings',
    href: '/settings',
    icon: Settings,
    roles: ['admin'], // Only admins can see settings
  },
]

interface SidebarProps {
  userRole?: 'admin' | 'designer' | 'employee'
}

export function Sidebar({ userRole = 'employee' }: SidebarProps) {
  const pathname = usePathname()
  const router = useRouter()
  const supabase = createClient()
  const filteredNav = navigation.filter((item) => item.roles.includes(userRole))

  const handleLogout = async () => {
    await supabase.auth.signOut()
    router.push('/auth/login')
    router.refresh()
  }

  return (
    <div className="flex h-screen w-64 flex-col border-r bg-background">
      <div className="flex h-16 items-center border-b px-6">
        <h1 className="text-xl font-semibold">Studio</h1>
      </div>
      <nav className="flex-1 space-y-1 px-3 py-4">
        {filteredNav.map((item) => {
          const Icon = item.icon
          const isActive = pathname === item.href || pathname?.startsWith(item.href + '/')
          
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                isActive
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
              )}
            >
              <Icon className="h-5 w-5" />
              {item.title}
            </Link>
          )
        })}
      </nav>
      <div className="border-t p-3">
        <Button
          variant="ghost"
          className="w-full justify-start"
          onClick={handleLogout}
        >
          <LogOut className="mr-2 h-4 w-4" />
          Sign out
        </Button>
      </div>
    </div>
  )
}

