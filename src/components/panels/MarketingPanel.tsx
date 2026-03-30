import { useState } from 'react'
import { FileText, ImageIcon, Sparkles, Loader2 } from 'lucide-react'
import AgentPanel from './AgentPanel'
import Button from '../ui/Button'
import toast from 'react-hot-toast'

export default function MarketingPanel({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState('contenuti')
  const [prompt, setPrompt] = useState('')
  const [generating, setGenerating] = useState(false)
  const [result, setResult] = useState('')
  const [imgPrompt, setImgPrompt] = useState('')
  const [imgGenerating, setImgGenerating] = useState(false)
  const [generatedImages, setGeneratedImages] = useState<string[]>([])

  const tabs = [
    { key: 'contenuti', label: 'Contenuti', icon: FileText },
    { key: 'immagini', label: 'Immagini', icon: ImageIcon },
  ]

  const handleGenerateContent = async () => {
    if (!prompt.trim()) {
      toast.error('Inserisci una descrizione del contenuto')
      return
    }
    setGenerating(true)
    setResult('')
    try {
      const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions'
      const OPENROUTER_API_KEY = import.meta.env.VITE_OPENROUTER_API_KEY ?? ''
      const res = await fetch(OPENROUTER_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
        },
        body: JSON.stringify({
          model: 'anthropic/claude-sonnet-4',
          messages: [
            {
              role: 'system',
              content: 'Sei un esperto di marketing e comunicazione aziendale italiana. Genera contenuti professionali, coinvolgenti e ottimizzati per il target indicato. Rispondi in italiano.',
            },
            { role: 'user', content: prompt },
          ],
          max_tokens: 1024,
        }),
      })
      if (!res.ok) throw new Error('Errore API')
      const data = await res.json()
      setResult(data.choices?.[0]?.message?.content ?? 'Nessun risultato generato.')
    } catch {
      toast.error('Errore nella generazione del contenuto')
    } finally {
      setGenerating(false)
    }
  }

  const handleGenerateImage = async () => {
    if (!imgPrompt.trim()) {
      toast.error('Inserisci una descrizione per l\'immagine')
      return
    }
    setImgGenerating(true)
    try {
      // Use OpenRouter image generation if available, otherwise show placeholder
      toast.success('Generazione immagine avviata - funzionalita\' in sviluppo')
      // Placeholder: in production this would call an image generation API
      setGeneratedImages((prev) => [...prev, `placeholder-${Date.now()}`])
    } catch {
      toast.error('Errore nella generazione')
    } finally {
      setImgGenerating(false)
    }
  }

  return (
    <AgentPanel title="Marketing" color="#9C27B0" tabs={tabs} activeTab={tab} onTabChange={setTab} onClose={onClose}>
      {tab === 'contenuti' && (
        <div className="space-y-3">
          <div>
            <label className="text-xs font-medium text-text2 mb-1.5 block">
              Descrivi il contenuto da generare
            </label>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Es: Post LinkedIn per lanciare il nostro nuovo servizio di consulenza aziendale..."
              rows={4}
              className="w-full bg-bg2 border border-border rounded-lg px-3 py-2 text-xs text-text placeholder:text-text3 focus:outline-none focus:border-gold/40 resize-none"
            />
          </div>
          <Button
            size="sm"
            variant="primary"
            onClick={handleGenerateContent}
            disabled={generating}
            className="w-full"
          >
            {generating ? (
              <>
                <Loader2 size={13} className="animate-spin" />
                Generazione in corso...
              </>
            ) : (
              <>
                <Sparkles size={13} />
                Genera con AI
              </>
            )}
          </Button>
          {result && (
            <div className="bg-bg2 border border-border rounded-lg p-3">
              <div className="flex items-center gap-1.5 mb-2">
                <Sparkles size={12} className="text-purple" />
                <span className="text-[10px] font-medium text-purple uppercase tracking-wider">Risultato</span>
              </div>
              <div className="text-xs text-text2 whitespace-pre-wrap leading-relaxed">{result}</div>
              <div className="flex gap-2 mt-2">
                <Button
                  size="sm"
                  onClick={() => {
                    navigator.clipboard.writeText(result)
                    toast.success('Copiato negli appunti')
                  }}
                >
                  Copia
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      {tab === 'immagini' && (
        <div className="space-y-3">
          <div>
            <label className="text-xs font-medium text-text2 mb-1.5 block">
              Descrizione immagine
            </label>
            <textarea
              value={imgPrompt}
              onChange={(e) => setImgPrompt(e.target.value)}
              placeholder="Es: Banner professionale per campagna social media, stile corporate moderno..."
              rows={3}
              className="w-full bg-bg2 border border-border rounded-lg px-3 py-2 text-xs text-text placeholder:text-text3 focus:outline-none focus:border-gold/40 resize-none"
            />
          </div>
          <Button
            size="sm"
            variant="primary"
            onClick={handleGenerateImage}
            disabled={imgGenerating}
            className="w-full"
          >
            {imgGenerating ? (
              <>
                <Loader2 size={13} className="animate-spin" />
                Generazione...
              </>
            ) : (
              <>
                <ImageIcon size={13} />
                Genera Immagine
              </>
            )}
          </Button>
          {generatedImages.length > 0 && (
            <div>
              <span className="text-xs font-medium text-text2 mb-2 block">Immagini generate</span>
              <div className="grid grid-cols-2 gap-2">
                {generatedImages.map((img, i) => (
                  <div
                    key={i}
                    className="aspect-square bg-bg2 border border-border rounded-lg flex items-center justify-center"
                  >
                    <ImageIcon size={24} className="text-text3" />
                  </div>
                ))}
              </div>
            </div>
          )}
          {generatedImages.length === 0 && (
            <p className="text-xs text-text3 text-center py-6">
              Nessuna immagine generata. Usa il pulsante sopra per creare contenuti visivi.
            </p>
          )}
        </div>
      )}
    </AgentPanel>
  )
}
