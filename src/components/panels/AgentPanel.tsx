import { X } from 'lucide-react'

interface TabDef {
  key: string
  label: string
  icon: React.ComponentType<{ size?: number; className?: string }>
}

interface AgentPanelProps {
  title: string
  color: string
  tabs: TabDef[]
  activeTab: string
  onTabChange: (key: string) => void
  onClose: () => void
  children: React.ReactNode
}

export default function AgentPanel({
  title,
  color,
  tabs,
  activeTab,
  onTabChange,
  onClose,
  children,
}: AgentPanelProps) {
  return (
    <div className="flex flex-col h-full bg-bg">
      {/* Header */}
      <div className="shrink-0 border-b border-border bg-bg2">
        <div className="flex items-center justify-between px-3 py-2">
          <div className="flex items-center gap-2">
            <div className="w-1 h-5 rounded-full" style={{ backgroundColor: color }} />
            <span className="text-sm font-semibold text-text">{title}</span>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-text3 hover:text-text hover:bg-bg3 transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* Tabs */}
        {tabs.length > 1 && (
          <div className="flex gap-0.5 px-3 pb-1.5 overflow-x-auto no-scrollbar">
            {tabs.map((tab) => {
              const Icon = tab.icon
              const isActive = activeTab === tab.key
              return (
                <button
                  key={tab.key}
                  onClick={() => onTabChange(tab.key)}
                  className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap ${
                    isActive
                      ? 'text-white'
                      : 'text-text3 hover:text-text hover:bg-bg3'
                  }`}
                  style={isActive ? { backgroundColor: color } : {}}
                >
                  <Icon size={13} />
                  {tab.label}
                </button>
              )
            })}
          </div>
        )}
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-3">
        {children}
      </div>
    </div>
  )
}
