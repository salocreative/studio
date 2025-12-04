'use client'

import { Sidebar } from './sidebar'

interface LayoutWrapperProps {
  children: React.ReactNode
  userRole?: 'admin' | 'designer' | 'employee'
}

export function LayoutWrapper({ children, userRole = 'employee' }: LayoutWrapperProps) {
  return (
    <div className="flex h-screen">
      <Sidebar userRole={userRole} />
      <main className="flex-1 overflow-y-auto">
        {children}
      </main>
    </div>
  )
}

