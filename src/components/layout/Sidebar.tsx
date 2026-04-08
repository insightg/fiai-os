import { NavLink, useNavigate } from 'react-router-dom'
import {
  LayoutDashboard,
  Users,
  UserCheck,
  FileText,
  ShoppingCart,
  FolderKanban,
  Receipt,
  RotateCcw,
  FileInput,
  Truck,
  Landmark,
  Wallet,
  BarChart3,
  Settings,
  LogOut,
  Calculator,
  Megaphone,
  UserSearch,
  FolderOpen,
  MessageSquare,
} from 'lucide-react'
import { useUiStore, useAuthStore } from '../../store'
import clsx from 'clsx'

type LinkItem = { to: string; label: string; icon: React.ComponentType<{ size?: number; className?: string }> }
type SectionItem = { section: string }
type NavItem = LinkItem | SectionItem

const navItems: NavItem[] = [
  { section: 'Personale' },
  { to: '/app/personale', label: 'Board & Calendario', icon: FolderKanban },
  { section: 'Gestionale' },
  { to: '/app/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/app/leads', label: 'Leads', icon: Users },
  { to: '/app/clienti', label: 'Clienti', icon: UserCheck },
  { to: '/app/preventivi', label: 'Preventivi', icon: FileText },
  { to: '/app/ordini', label: 'Ordini', icon: ShoppingCart },
  { to: '/app/progetti', label: 'Progetti', icon: FolderKanban },
  { to: '/app/fatture', label: 'Fatture', icon: Receipt },
  { to: '/app/fatture/ricorrenti', label: 'Ricorrenti', icon: RotateCcw },
  { to: '/app/fatture-passive', label: 'Fatture Passive', icon: FileInput },
  { to: '/app/fornitori', label: 'Fornitori', icon: Truck },
  { to: '/app/conti', label: 'Conti', icon: Landmark },
  { to: '/app/rimborsi', label: 'Rimborsi', icon: Wallet },
  { section: 'HR' },
  { to: '/app/hr/simulatore-costo', label: 'Simulatore Costo', icon: Calculator },
  { to: '/app/hr/annunci', label: 'Annunci Lavoro', icon: Megaphone },
  { to: '/app/hr/candidati', label: 'Candidati', icon: UserSearch },
  { section: 'Documenti' },
  { to: '/app/documenti', label: 'Documenti', icon: FolderOpen },
  { section: 'Sistema' },
  { to: '/app/report', label: 'Report', icon: BarChart3 },
  { to: '/app/impostazioni', label: 'Impostazioni', icon: Settings },
]

function isSection(item: NavItem): item is SectionItem {
  return 'section' in item
}

export default function Sidebar() {
  const sidebarOpen = useUiStore((s) => s.sidebarOpen)
  const logout = useAuthStore((s) => s.logout)
  const navigate = useNavigate()

  return (
    <aside
      className={clsx(
        'fixed left-0 top-0 z-30 h-screen bg-bg2 border-r border-border flex flex-col transition-all duration-200',
        sidebarOpen ? 'w-[220px]' : 'w-[60px]'
      )}
    >
      <div className="h-[52px] flex items-center px-4 border-b border-border">
        <span className="font-display text-gold text-xl font-bold tracking-wide">
          {sidebarOpen ? 'BERNARDINI' : 'B'}
        </span>
      </div>

      {/* Torna alla Chat */}
      <div className="px-2 pt-3 pb-1">
        <button
          onClick={() => navigate('/')}
          className={clsx(
            'flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors w-full',
            'text-gold bg-gold/10 hover:bg-gold/20 font-medium'
          )}
        >
          <MessageSquare size={18} className="shrink-0" />
          {sidebarOpen && <span>Torna alla Chat</span>}
        </button>
      </div>

      <nav className="flex-1 overflow-y-auto py-3 px-2 space-y-0.5">
        {navItems.map((item, i) => {
          if (isSection(item)) {
            if (!sidebarOpen) return <div key={i} className="border-t border-border my-2" />
            return (
              <div key={i} className="pt-4 pb-1 px-3">
                <span className="text-[10px] uppercase tracking-wider text-text3 font-semibold">
                  {item.section}
                </span>
              </div>
            )
          }
          return (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                clsx(
                  'flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors',
                  isActive
                    ? 'bg-gold/10 text-gold font-medium'
                    : 'text-text2 hover:text-text hover:bg-bg3'
                )
              }
            >
              <item.icon size={18} className="shrink-0" />
              {sidebarOpen && <span className="truncate">{item.label}</span>}
            </NavLink>
          )
        })}
      </nav>

      <div className="border-t border-border px-2 py-3">
        <button
          onClick={() => logout()}
          className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-text2 hover:text-red hover:bg-red/10 transition-colors w-full"
        >
          <LogOut size={18} className="shrink-0" />
          {sidebarOpen && <span>Esci</span>}
        </button>
      </div>
    </aside>
  )
}
