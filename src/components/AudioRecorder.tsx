import { useState, useRef, useCallback, useEffect } from 'react'
import { Mic, Square, Play, Pause, Check, RotateCcw, X } from 'lucide-react'

interface AudioRecorderProps {
  onRecordingComplete: (audioBlob: Blob, base64: string) => void
  onCancel: () => void
}

export default function AudioRecorder({ onRecordingComplete, onCancel }: AudioRecorderProps) {
  const [state, setState] = useState<'idle' | 'recording' | 'preview'>('idle')
  const [duration, setDuration] = useState(0)
  const [audioUrl, setAudioUrl] = useState<string | null>(null)
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null)
  const [isPlaying, setIsPlaying] = useState(false)

  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(t => t.stop())
      }
      if (audioUrl) URL.revokeObjectURL(audioUrl)
    }
  }, [audioUrl])

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60)
    const s = seconds % 60
    return `${m}:${s.toString().padStart(2, '0')}`
  }

  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream
      chunksRef.current = []

      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : 'audio/webm'

      const recorder = new MediaRecorder(stream, { mimeType })
      mediaRecorderRef.current = recorder

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data)
      }

      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: mimeType })
        setAudioBlob(blob)
        const url = URL.createObjectURL(blob)
        setAudioUrl(url)
        setState('preview')

        // Stop all tracks
        stream.getTracks().forEach(t => t.stop())
      }

      recorder.start(100) // collect data every 100ms
      setState('recording')
      setDuration(0)

      timerRef.current = setInterval(() => {
        setDuration(d => d + 1)
      }, 1000)
    } catch (err: any) {
      const msg = err.name === 'NotAllowedError'
        ? 'Permesso microfono negato. Controlla le impostazioni del browser.'
        : `Errore microfono: ${err.message || 'sconosciuto'}`
      // Import toast dynamically to keep component lean
      const { default: toast } = await import('react-hot-toast')
      toast.error(msg)
      onCancel()
    }
  }, [onCancel])

  const stopRecording = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop()
    }
  }, [])

  const handleRetry = useCallback(() => {
    if (audioUrl) URL.revokeObjectURL(audioUrl)
    setAudioUrl(null)
    setAudioBlob(null)
    setDuration(0)
    setIsPlaying(false)
    setState('idle')
  }, [audioUrl])

  const handleConfirm = useCallback(() => {
    if (!audioBlob) return
    const reader = new FileReader()
    reader.onload = () => {
      onRecordingComplete(audioBlob, reader.result as string)
    }
    reader.readAsDataURL(audioBlob)
  }, [audioBlob, onRecordingComplete])

  const togglePlayback = useCallback(() => {
    if (!audioRef.current) return
    if (isPlaying) {
      audioRef.current.pause()
      setIsPlaying(false)
    } else {
      audioRef.current.play()
      setIsPlaying(true)
    }
  }, [isPlaying])

  // Auto-start recording on mount
  useEffect(() => {
    if (state === 'idle') {
      startRecording()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="bg-bg3 border border-border rounded-xl px-4 py-3 mb-2">
      {/* Recording state */}
      {state === 'recording' && (
        <div className="flex items-center gap-3">
          <span className="relative flex h-3 w-3">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red opacity-75" />
            <span className="relative inline-flex rounded-full h-3 w-3 bg-red" />
          </span>
          <span className="text-sm text-text flex-1">
            Registrazione in corso...
          </span>
          <span className="text-sm text-gold font-mono tabular-nums">{formatTime(duration)}</span>
          <button
            type="button"
            onClick={stopRecording}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-red/20 hover:bg-red/30 text-red rounded-lg transition-colors text-sm"
          >
            <Square size={14} fill="currentColor" />
            Stop
          </button>
          <button
            type="button"
            onClick={() => {
              stopRecording()
              // Wait a tick for onstop to fire, then cancel
              setTimeout(onCancel, 100)
            }}
            className="p-1.5 text-text3 hover:text-text transition-colors"
            title="Annulla"
          >
            <X size={16} />
          </button>
        </div>
      )}

      {/* Preview state */}
      {state === 'preview' && audioUrl && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Mic size={16} className="text-gold" />
            <span className="text-sm text-text flex-1">
              Registrazione ({formatTime(duration)})
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={togglePlayback}
              className="p-1.5 text-gold hover:text-gold-l transition-colors"
            >
              {isPlaying ? <Pause size={16} /> : <Play size={16} />}
            </button>
            <audio
              ref={audioRef}
              src={audioUrl}
              onEnded={() => setIsPlaying(false)}
              className="hidden"
            />
            <div className="flex-1 h-1 bg-border rounded-full overflow-hidden">
              <div className="h-full bg-gold rounded-full" style={{ width: '100%' }} />
            </div>
            <span className="text-xs text-text3 font-mono tabular-nums">{formatTime(duration)}</span>
          </div>

          <div className="flex items-center gap-2 pt-1">
            <button
              type="button"
              onClick={handleConfirm}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-green/20 hover:bg-green/30 text-green rounded-lg transition-colors text-sm"
            >
              <Check size={14} />
              Usa questa registrazione
            </button>
            <button
              type="button"
              onClick={handleRetry}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-bg2 hover:bg-bg text-text3 hover:text-text rounded-lg transition-colors text-sm"
            >
              <RotateCcw size={14} />
              Riprova
            </button>
            <button
              type="button"
              onClick={onCancel}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-bg2 hover:bg-bg text-text3 hover:text-text rounded-lg transition-colors text-sm"
            >
              <X size={14} />
              Annulla
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
