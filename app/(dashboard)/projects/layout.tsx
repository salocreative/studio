export default function ProjectsLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col h-full">
      <div className="border-b bg-background">
        <div className="flex h-16 items-center px-6">
          <div>
            <h1 className="text-2xl font-semibold">Projects</h1>
            <p className="text-sm text-muted-foreground">
              View project status and time tracking
            </p>
          </div>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-6">{children}</div>
    </div>
  )
}
