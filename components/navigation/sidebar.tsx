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
  LogOut,
  Palette,
  TrendingUp,
  Menu,
  Calculator,
  Target,
  FileText
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { useState, useEffect } from 'react'

export interface NavItem {
  title: string
  href: string
  icon: React.ComponentType<{ className?: string }>
  roles: ('admin' | 'designer' | 'manager')[]
}

export const navigation: NavItem[] = [
  {
    title: 'Time Tracking',
    href: '/time-tracking',
    icon: Clock,
    roles: ['admin', 'designer', 'manager'],
  },
  {
    title: 'Projects',
    href: '/projects',
    icon: FolderKanban,
    roles: ['admin', 'designer', 'manager'],
  },
  {
    title: 'Flexi-Design',
    href: '/flexi-design',
    icon: Palette,
    roles: ['admin', 'designer', 'manager'], // Admins, designers, and managers can see Flexi-Design
  },
  {
    title: 'Quote',
    href: '/quote',
    icon: Calculator,
    roles: ['admin', 'designer', 'manager'], // All authenticated users can create quotes
  },
  {
    title: 'Performance',
    href: '/performance',
    icon: TrendingUp,
    roles: ['admin', 'designer', 'manager'], // Admins, designers, and managers can see performance
  },
  {
    title: 'Forecast',
    href: '/forecast',
    icon: Calendar,
    roles: ['admin'], // Admin only
  },
  {
    title: 'Leads',
    href: '/leads',
    icon: Target,
    roles: ['admin'], // Admin only
  },
  {
    title: 'Scorecard',
    href: '/scorecard',
    icon: Trophy,
    roles: ['admin'], // Admin only
  },
  {
    title: 'Customers',
    href: '/customers',
    icon: Users,
    roles: ['admin'], // Admin only
  },
  {
    title: 'Documents',
    href: '/documents',
    icon: FileText,
    roles: ['admin', 'designer', 'manager'], // All authenticated users can view documents
  },
  {
    title: 'Settings',
    href: '/settings',
    icon: Settings,
    roles: ['admin'], // Only admins can see settings
  },
]

interface SidebarProps {
  userRole?: 'admin' | 'designer' | 'manager'
}

export function Sidebar({ userRole = 'manager' }: SidebarProps) {
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
    <div className="hidden md:flex h-screen w-64 flex-col border-r bg-background">
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

/**
 * Mobile Navigation Component
 */
interface MobileNavProps {
  userRole?: 'admin' | 'designer' | 'manager'
}

export function MobileNav({ userRole = 'manager' }: MobileNavProps) {
  const pathname = usePathname()
  const router = useRouter()
  const supabase = createClient()
  const [open, setOpen] = useState(false)
  const [mounted, setMounted] = useState(false)
  const filteredNav = navigation.filter((item) => item.roles.includes(userRole))

  useEffect(() => {
    setMounted(true)
  }, [])

  const handleLogout = async () => {
    await supabase.auth.signOut()
    router.push('/auth/login')
    router.refresh()
    setOpen(false)
  }

  const handleNavClick = () => {
    setOpen(false)
  }

  // Prevent hydration mismatch by only rendering Sheet on client
  if (!mounted) {
    return (
      <Button variant="ghost" size="icon" className="md:hidden" disabled>
        <Menu className="h-6 w-6" />
        <span className="sr-only">Toggle menu</span>
      </Button>
    )
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" className="md:hidden">
          <Menu className="h-6 w-6" />
          <span className="sr-only">Toggle menu</span>
        </Button>
      </SheetTrigger>
      <SheetContent side="left" className="w-64 p-0">
        <SheetHeader className="border-b px-6 py-4">
          <SheetTitle className="text-xl font-semibold">Studio</SheetTitle>
        </SheetHeader>
        <nav className="flex-1 space-y-1 px-3 py-4">
          {filteredNav.map((item) => {
            const Icon = item.icon
            const isActive = pathname === item.href || pathname?.startsWith(item.href + '/')
            
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={handleNavClick}
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
      </SheetContent>
    </Sheet>
  )
}

