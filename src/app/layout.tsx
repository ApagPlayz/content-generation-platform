import type { Metadata } from 'next'
import { Suspense } from 'react'
import { AppShell, NavBar } from '@/components/app-shell'
import { THEME_BOOT_SCRIPT } from '@/lib/ui/theme'
import './globals.css'

export const metadata: Metadata = {
  title: 'Content Engine',
  description: 'AI short-form video generation, publishing & analytics',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Applies the saved light/dark choice before the first paint. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
      </head>
      <body className="antialiased">
        <div className="min-h-screen flex flex-col bg-canvas">
          <Suspense fallback={<NavBar />}>
            <AppShell />
          </Suspense>
          <div className="flex-1 flex flex-col">{children}</div>
        </div>
      </body>
    </html>
  )
}
