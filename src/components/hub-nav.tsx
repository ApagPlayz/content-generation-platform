'use client'

import { useRouter } from 'next/navigation'

const TABS = [
  { id: 'overview',   label: 'Overview' },
  { id: 'factories',  label: 'Factories' },
  { id: 'agents',     label: 'Agents' },
  { id: 'inbox',      label: 'Inbox' },
  { id: 'queue',      label: 'Queue' },
  { id: 'schedule',   label: 'Schedule' },
  { id: 'winners',    label: 'Winners' },
]

export function HubNav({ activeTab }: { activeTab: string }) {
  const router = useRouter()

  return (
    <nav className="flex items-center overflow-x-auto">
      {TABS.map((tab) => (
        <button
          key={tab.id}
          onClick={() =>
            router.push(tab.id === 'overview' ? '/' : `/?tab=${tab.id}`)
          }
          className={`px-4 py-3 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
            activeTab === tab.id
              ? 'border-gray-900 text-gray-900'
              : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
          }`}
        >
          {tab.label}
        </button>
      ))}
    </nav>
  )
}
