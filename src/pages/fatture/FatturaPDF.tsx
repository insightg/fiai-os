import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, Download } from 'lucide-react'
import toast from 'react-hot-toast'
import { useAuthStore, useFattureStore } from '../../store'
import { supabase } from '../../lib/supabase'
import Button from '../../components/ui/Button'
import { generateInvoicePdfBlob, downloadBlob } from '../../lib/pdf'
import type { Fattura, Azienda, Cliente } from '../../types'

export default function FatturaPDF() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const profile = useAuthStore((s) => s.profile)
  const { fetchOne } = useFattureStore()
  const [fattura, setFattura] = useState<Fattura | null>(null)
  const [azienda, setAzienda] = useState<Azienda | null>(null)
  const [pdfUrl, setPdfUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const load = async () => {
      if (!id || !profile?.azienda_id) return
      setLoading(true)

      const [fatturaData, aziendaRes] = await Promise.all([
        fetchOne(id),
        supabase.from('aziende').select('*').eq('id', profile.azienda_id).single(),
      ])

      if (!fatturaData) {
        toast.error('Fattura non trovata')
        setLoading(false)
        return
      }

      if (aziendaRes.error || !aziendaRes.data) {
        toast.error('Errore nel caricamento dati azienda')
        setLoading(false)
        return
      }

      const az = aziendaRes.data as Azienda
      setFattura(fatturaData)
      setAzienda(az)

      try {
        const blob = await generateInvoicePdfBlob(
          fatturaData,
          fatturaData.righe ?? [],
          az,
          fatturaData.cliente as Cliente
        )
        const url = URL.createObjectURL(blob)
        setPdfUrl(url)
      } catch {
        toast.error('Errore nella generazione PDF')
      }

      setLoading(false)
    }

    load()

    return () => {
      if (pdfUrl) URL.revokeObjectURL(pdfUrl)
    }
  }, [id, profile?.azienda_id])

  const handleDownload = async () => {
    if (!fattura || !azienda || !fattura.cliente) return
    try {
      const blob = await generateInvoicePdfBlob(
        fattura,
        fattura.righe ?? [],
        azienda,
        fattura.cliente as Cliente
      )
      downloadBlob(blob, `Fattura_${fattura.numero}.pdf`)
      toast.success('PDF scaricato')
    } catch {
      toast.error('Errore nel download PDF')
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="text-gold font-display text-lg animate-pulse">Generazione PDF in corso...</div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button
            onClick={() => navigate('/app/fatture')}
            className="p-2 rounded-lg text-text3 hover:text-text hover:bg-bg3 transition-colors"
          >
            <ArrowLeft size={20} />
          </button>
          <h1 className="text-2xl font-display font-bold text-text">
            Anteprima PDF - Fattura {fattura?.numero}
          </h1>
        </div>
        <Button variant="primary" onClick={handleDownload}>
          <Download size={16} />
          Scarica PDF
        </Button>
      </div>

      {pdfUrl ? (
        <div className="bg-bg2 border border-border rounded-xl overflow-hidden" style={{ height: 'calc(100vh - 180px)' }}>
          <iframe
            src={pdfUrl}
            title="Anteprima Fattura PDF"
            className="w-full h-full"
            style={{ border: 'none' }}
          />
        </div>
      ) : (
        <div className="flex items-center justify-center py-20">
          <p className="text-text3">Impossibile generare l&apos;anteprima PDF.</p>
        </div>
      )}
    </div>
  )
}
