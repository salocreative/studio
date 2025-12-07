'use client'

import { Sidebar, MobileNav } from './sidebar'

interface LayoutWrapperProps {
  children: React.ReactNode
  userRole?: 'admin' | 'designer' | 'manager'
}

export function LayoutWrapper({ children, userRole = 'manager' }: LayoutWrapperProps) {
  return (
    <div className="flex h-screen">
      <Sidebar userRole={userRole} />
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Mobile header with menu button */}
        <header className="md:hidden flex h-16 items-center border-b bg-background px-4">
          <MobileNav userRole={userRole} />
          <h1 className="ml-4 text-xl font-semibold">Studio</h1>
        </header>
        <main className="flex-1 overflow-y-auto">
          {children}
        </main>
      </div>
    </div>
  )
}

