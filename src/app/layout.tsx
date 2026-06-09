import type { Metadata } from 'next'
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
    <html lang="en">
      <body className="antialiased">
        <div className="min-h-screen flex flex-col">
          {children}
        </div>
      </body>
    </html>
  )
}
