import { NavLink } from 'react-router-dom'
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
  Bot,
  Settings,
  LogOut,
  Calculator,
  Megaphone,
  UserSearch,
  FolderOpen,
} from 'lucide-react'
import { useUiStore, useAuthStore } from '../../store'
import clsx from 'clsx'

type LinkItem = { to: string; label: string; icon: React.ComponentType<{ size?: number; className?: string }> }
type SectionItem = { section: string }
type NavItem = LinkItem | SectionItem

const navItems: NavItem[] = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/leads', label: 'Leads', icon: Users },
  { to: '/clienti', label: 'Clienti', icon: UserCheck },
  { to: '/preventivi', label: 'Preventivi', icon: FileText },
  { to: '/ordini', label: 'Ordini', icon: ShoppingCart },
  { to: '/progetti', label: 'Progetti', icon: FolderKanban },
  { to: '/fatture', label: 'Fatture', icon: Receipt },
  { to: '/fatture/ricorrenti', label: 'Ricorrenti', icon: RotateCcw },
  { to: '/fatture-passive', label: 'Fatture Passive', icon: FileInput },
  { to: '/fornitori', label: 'Fornitori', icon: Truck },
  { to: '/conti', label: 'Conti', icon: Landmark },
  { to: '/rimborsi', label: 'Rimborsi', icon: Wallet },
  { section: 'HR' },
  { to: '/hr/simulatore-costo', label: 'Simulatore Costo', icon: Calculator },
  { to: '/hr/annunci', label: 'Annunci Lavoro', icon: Megaphone },
  { to: '/hr/candidati', label: 'Candidati', icon: UserSearch },
  { section: 'Documenti' },
  { to: '/documenti', label: 'Documenti', icon: FolderOpen },
  { section: 'Sistema' },
  { to: '/report', label: 'Report', icon: BarChart3 },
  { to: '/impostazioni', label: 'Impostazioni', icon: Settings },
]

function isSection(item: NavItem): item is SectionItem {
  return 'section' in item
}

export default function Sidebar() {
  const sidebarOpen = useUiStore((s) => s.sidebarOpen)
  const logout = useAuthStore((s) => s.logout)

  return (
    <aside
      className={clsx(
        'fixed left-0 top-0 z-30 h-screen bg-bg2 border-r border-border flex flex-col transition-all duration-200',
        sidebarOpen ? 'w-[220px]' : 'w-[60px]'
      )}
    >
      <div className="h-[52px] flex items-center px-4 border-b border-border">
        <span className="font-display text-gold text-xl font-bold tracking-wide">
          {sidebarOpen ? 'FIAI' : 'F'}
        </span>
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
