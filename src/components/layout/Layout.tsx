import { Outlet } from 'react-router-dom'
import Sidebar from './Sidebar'
import Topbar from './Topbar'
import ChatWidget from '../ChatWidget'
import { useUiStore } from '../../store'
import clsx from 'clsx'

export default function Layout() {
  const sidebarOpen = useUiStore((s) => s.sidebarOpen)

  return (
    <div className="min-h-screen bg-bg">
      <Sidebar />
      <div
        className={clsx(
          'transition-all duration-200',
          sidebarOpen ? 'ml-[220px]' : 'ml-[60px]'
        )}
      >
        <Topbar />
        <main className="p-6">
          <Outlet />
        </main>
      </div>
      <ChatWidget />
    </div>
  )
}
