import type { Metadata } from 'next'
import { AppShell } from '@/components/app-shell'
import { THEME_KEY } from '@/lib/ui/nav'
import './globals.css'

export const metadata: Metadata = {
  title: 'Content Engine',
  description: 'AI short-form video generation, publishing & analytics',
}

// Runs synchronously before the first paint, so a dark-mode reload never
// flashes the light palette. Must stay inline — a deferred script paints first.
const APPLY_SAVED_THEME = `try{if(localStorage.getItem(${JSON.stringify(
  THEME_KEY,
)})==='dark')document.documentElement.classList.add('dark')}catch(e){}`

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    // suppressHydrationWarning: the script above may add `dark` to <html>
    // before React hydrates, which would otherwise look like a mismatch.
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: APPLY_SAVED_THEME }} />
      </head>
      <body className="antialiased">
        <div className="min-h-screen flex flex-col">
          <AppShell>{children}</AppShell>
        </div>
      </body>
    </html>
  )
}
