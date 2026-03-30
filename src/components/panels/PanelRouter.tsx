import { lazy, Suspense } from 'react'
import { Loader2 } from 'lucide-react'

const PulsePanel = lazy(() => import('./PulsePanel'))
const CommercialePanel = lazy(() => import('./CommercialePanel'))
const ProduzionePanel = lazy(() => import('./ProduzionePanel'))
const MarketingPanel = lazy(() => import('./MarketingPanel'))
const AmministrazionePanel = lazy(() => import('./AmministrazionePanel'))
const HrPanel = lazy(() => import('./HrPanel'))
const LegalPanel = lazy(() => import('./LegalPanel'))
const InfraPanel = lazy(() => import('./InfraPanel'))
const PersonalPanel = lazy(() => import('./PersonalPanel'))

function PanelFallback() {
  return (
    <div className="flex items-center justify-center h-full">
      <Loader2 className="w-5 h-5 text-text3 animate-spin" />
    </div>
  )
}

export default function PanelRouter({ domain, onClose }: { domain: string; onClose: () => void }) {
  const panel = (() => {
    switch (domain) {
      case 'pulse':
        return <PulsePanel onClose={onClose} />
      case 'commerciale':
        return <CommercialePanel onClose={onClose} />
      case 'produzione':
        return <ProduzionePanel onClose={onClose} />
      case 'marketing':
        return <MarketingPanel onClose={onClose} />
      case 'amministrazione':
        return <AmministrazionePanel onClose={onClose} />
      case 'hr':
        return <HrPanel onClose={onClose} />
      case 'legal':
        return <LegalPanel onClose={onClose} />
      case 'infra':
        return <InfraPanel onClose={onClose} />
      case 'personal':
        return <PersonalPanel onClose={onClose} />
      default:
        return null
    }
  })()

  return (
    <Suspense fallback={<PanelFallback />}>
      {panel}
    </Suspense>
  )
}
