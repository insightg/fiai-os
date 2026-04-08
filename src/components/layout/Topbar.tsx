import { Menu } from 'lucide-react'
import { useAuthStore, useUiStore } from '../../store'

export default function Topbar() {
  const profile = useAuthStore((s) => s.profile)
  const toggleSidebar = useUiStore((s) => s.toggleSidebar)
  const sidebarOpen = useUiStore((s) => s.sidebarOpen)

  const initials = profile
    ? `${profile.nome.charAt(0)}${profile.cognome.charAt(0)}`.toUpperCase()
    : '??'

  return (
    <header
      className="h-[52px] bg-bg2 border-b border-border flex items-center justify-between px-4 sticky top-0 z-20"
    >
      <div className="flex items-center gap-3">
        <button
          onClick={toggleSidebar}
          className="p-1.5 rounded-lg hover:bg-bg3 text-text2 hover:text-text transition-colors"
        >
          <Menu size={20} />
        </button>
        <span className="font-display text-gold font-bold text-lg tracking-wide">
          BERNARDINI
        </span>
      </div>

      <div className="flex items-center gap-3">
        {profile && (
          <span className="text-sm text-text2 hidden sm:inline">
            {profile.nome} {profile.cognome}
          </span>
        )}
        <div
          className="w-8 h-8 rounded-full bg-gold/20 text-gold text-xs font-semibold flex items-center justify-center"
          style={{ marginLeft: sidebarOpen ? 0 : undefined }}
        >
          {profile?.avatar_url ? (
            <img
              src={profile.avatar_url}
              alt="Avatar"
              className="w-8 h-8 rounded-full object-cover"
            />
          ) : (
            initials
          )}
        </div>
      </div>
    </header>
  )
}
