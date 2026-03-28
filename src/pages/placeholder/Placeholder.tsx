import { Construction } from 'lucide-react'

interface PlaceholderProps {
  title: string
}

export default function Placeholder({ title }: PlaceholderProps) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="w-16 h-16 rounded-2xl bg-gold/10 flex items-center justify-center mb-4">
        <Construction size={32} className="text-gold" />
      </div>
      <h1 className="text-2xl font-display font-bold text-text mb-2">{title}</h1>
      <p className="text-text2 text-sm">Prossimamente disponibile</p>
    </div>
  )
}
