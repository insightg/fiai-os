import { useState, useRef, useCallback, useEffect } from 'react'
import { Mic, MicOff, Volume2, Loader2, X, PhoneCall } from 'lucide-react'
import { getAuthToken } from '../lib/supabase'
import toast from 'react-hot-toast'

interface VoiceChatProps {
  onSendMessage: (text: string) => Promise<string>
  onClose: () => void
}

type VoiceMode = 'idle' | 'listening' | 'processing' | 'speaking'

export default function VoiceChat({ onSendMessage, onClose }: VoiceChatProps) {
  const [mode, setMode] = useState<VoiceMode>('idle')
  const [transcript, setTranscript] = useState('')
  const [continuous, setContinuous] = useState(false)
  const [responseText, setResponseText] = useState('')
  const recognitionRef = useRef<any>(null)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const mountedRef = useRef(true)
  const playingRef = useRef(false)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      recognitionRef.current?.stop()
      abortRef.current?.abort()
      audioCtxRef.current?.close()
    }
  }, [])

  const getAudioContext = () => {
    if (!audioCtxRef.current || audioCtxRef.current.state === 'closed') {
      audioCtxRef.current = new AudioContext({ sampleRate: 24000 })
    }
    return audioCtxRef.current
  }

  const startListening = useCallback(() => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    if (!SR) {
      toast.error('Riconoscimento vocale non supportato. Usa Chrome o Edge.')
      return
    }

    const recognition = new SR()
    recognition.lang = 'it-IT'
    recognition.continuous = false
    recognition.interimResults = true
    recognition.maxAlternatives = 1

    recognition.onresult = (event: any) => {
      const result = event.results[event.results.length - 1]
      if (!mountedRef.current) return
      setTranscript(result[0].transcript)

      if (result.isFinal) {
        const finalText = result[0].transcript
        recognitionRef.current = null
        handleVoiceInput(finalText)
      }
    }

    recognition.onend = () => {
      // noop
    }

    recognition.onerror = (event: any) => {
      if (!mountedRef.current) return
      if (event.error === 'not-allowed') {
        toast.error('Permesso microfono negato')
      }
      setMode('idle')
    }

    recognitionRef.current = recognition
    recognition.start()
    setMode('listening')
    setTranscript('')
    setResponseText('')
  }, [])

  const handleVoiceInput = async (text: string) => {
    if (!text.trim()) { setMode('idle'); return }
    if (!mountedRef.current) return

    setMode('processing')

    try {
      const response = await onSendMessage(text)
      if (!mountedRef.current) return

      setResponseText(response)

      if (response) {
        streamSpeak(response)
      } else {
        setMode('idle')
      }
    } catch {
      if (mountedRef.current) setMode('idle')
    }
  }

  const streamSpeak = async (text: string) => {
    if (!mountedRef.current) return
    setMode('speaking')
    playingRef.current = true

    const controller = new AbortController()
    abortRef.current = controller

    try {
      const token = getAuthToken()
      const res = await fetch('/api/tts/stream', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          text: text.substring(0, 500),
          language: 'Italian',
        }),
        signal: controller.signal,
      })

      if (!res.ok || !res.body) {
        // Fallback to browser speechSynthesis
        fallbackSpeak(text)
        return
      }

      const ctx = getAudioContext()
      if (ctx.state === 'suspended') await ctx.resume()

      const reader = res.body.getReader()
      // 0.5s @ 24kHz 16-bit mono = 24000 bytes
      const CHUNK_SIZE = 24000
      let carryOver = new Uint8Array(0)

      // Single ScriptProcessorNode queues PCM segments in order
      const queue: Float32Array[] = []
      let queuePos = 0
      let currentSegment: Float32Array | null = null
      let streamDone = false

      const processor = ctx.createScriptProcessor(4096, 1, 1)
      processor.onaudioprocess = (e) => {
        const output = e.outputBuffer.getChannelData(0)
        let written = 0
        while (written < output.length) {
          if (!currentSegment || queuePos >= currentSegment.length) {
            if (queue.length > 0) {
              currentSegment = queue.shift()!
              queuePos = 0
            } else {
              // No data — fill silence
              output.fill(0, written)
              return
            }
          }
          const remaining = currentSegment.length - queuePos
          const toCopy = Math.min(remaining, output.length - written)
          output.set(currentSegment.subarray(queuePos, queuePos + toCopy), written)
          queuePos += toCopy
          written += toCopy
        }
      }
      processor.connect(ctx.destination)

      const enqueuePcm = (pcmBytes: Uint8Array) => {
        const samples = pcmBytes.byteLength / 2
        if (samples === 0) return
        const floats = new Float32Array(samples)
        const view = new DataView(pcmBytes.buffer, pcmBytes.byteOffset, pcmBytes.byteLength)
        for (let i = 0; i < samples; i++) {
          floats[i] = view.getInt16(i * 2, true) / 32768
        }
        queue.push(floats)
      }

      while (true) {
        const { done, value } = await reader.read()
        if (!mountedRef.current || !playingRef.current) {
          reader.cancel()
          break
        }

        if (!done) {
          const combined = carryOver.byteLength > 0
            ? mergeUint8Arrays([carryOver, value])
            : value

          let offset = 0
          while (offset + CHUNK_SIZE <= combined.byteLength) {
            enqueuePcm(combined.slice(offset, offset + CHUNK_SIZE))
            offset += CHUNK_SIZE
          }
          carryOver = offset < combined.byteLength ? combined.slice(offset) : new Uint8Array(0)
        } else {
          if (carryOver.byteLength >= 2) {
            const alignedLen = carryOver.byteLength - (carryOver.byteLength % 2)
            enqueuePcm(carryOver.slice(0, alignedLen))
          }
          streamDone = true
          break
        }
      }

      // Wait for queue to drain
      if (playingRef.current && streamDone) {
        await new Promise<void>((resolve) => {
          const check = () => {
            if (!playingRef.current || (queue.length === 0 && (!currentSegment || queuePos >= currentSegment.length))) {
              processor.disconnect()
              resolve()
            } else {
              setTimeout(check, 200)
            }
          }
          check()
        })
      } else {
        processor.disconnect()
      }

      if (!mountedRef.current) return
      if (continuous && playingRef.current) {
        setTimeout(() => startListening(), 400)
      } else {
        setMode('idle')
      }
    } catch (err: any) {
      if (err.name === 'AbortError') return
      console.warn('TTS stream error, falling back to browser TTS:', err)
      fallbackSpeak(text)
    }
  }

  const fallbackSpeak = (text: string) => {
    if (!mountedRef.current) return
    setMode('speaking')

    const cleanText = text
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/\*([^*]+)\*/g, '$1')
      .replace(/#{1,6}\s/g, '')
      .replace(/```[\s\S]*?```/g, '')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      .replace(/[-*]\s/g, '')
      .replace(/\n+/g, '. ')
      .substring(0, 300)

    const utterance = new SpeechSynthesisUtterance(cleanText)
    utterance.lang = 'it-IT'
    utterance.rate = 1.05

    const voices = speechSynthesis.getVoices()
    const italianVoice = voices.find(v => v.lang.startsWith('it'))
    if (italianVoice) utterance.voice = italianVoice

    utterance.onend = () => {
      if (!mountedRef.current) return
      if (continuous) {
        setTimeout(() => startListening(), 400)
      } else {
        setMode('idle')
      }
    }

    utterance.onerror = () => {
      if (mountedRef.current) setMode('idle')
    }

    speechSynthesis.speak(utterance)
  }

  const stop = useCallback(() => {
    recognitionRef.current?.stop()
    recognitionRef.current = null
    playingRef.current = false
    abortRef.current?.abort()
    abortRef.current = null
    speechSynthesis.cancel()
    setContinuous(false)
    setMode('idle')
  }, [])

  const toggleContinuous = useCallback(() => {
    if (continuous) {
      stop()
    } else {
      setContinuous(true)
      startListening()
    }
  }, [continuous, stop, startListening])

  return (
    <div className="bg-bg2 border border-border rounded-xl p-3 mb-2 shadow-lg">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <div className={`w-3 h-3 rounded-full ${
            mode === 'listening' ? 'bg-red animate-pulse' :
            mode === 'processing' ? 'bg-amber animate-pulse' :
            mode === 'speaking' ? 'bg-green animate-pulse' :
            'bg-text3'
          }`} />
          <span className="text-xs font-medium text-text">
            {mode === 'listening' ? 'Sto ascoltando...' :
             mode === 'processing' ? 'Elaboro...' :
             mode === 'speaking' ? 'FIAI sta parlando...' :
             'Modalita vocale'}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={toggleContinuous}
            className={`p-1.5 rounded-lg text-[10px] transition-colors ${
              continuous ? 'bg-gold/20 text-gold' : 'text-text3 hover:text-text hover:bg-bg3'
            }`}
            title="Conversazione continua"
          >
            <PhoneCall size={14} />
          </button>
          <button
            onClick={() => { stop(); onClose() }}
            className="p-1.5 rounded-lg text-text3 hover:text-red hover:bg-red/10 transition-colors"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {transcript && (
        <div className="text-xs text-text2 mb-2 italic bg-bg3 rounded-lg px-3 py-2">
          &ldquo;{transcript}&rdquo;
        </div>
      )}

      {responseText && mode === 'speaking' && (
        <div className="text-[10px] text-text3 mb-2 max-h-16 overflow-hidden">
          {responseText.substring(0, 150)}...
        </div>
      )}

      <div className="flex items-center gap-2 justify-center">
        {mode === 'idle' && (
          <button
            onClick={startListening}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-gold hover:bg-gold-l text-white text-xs font-medium transition-colors"
          >
            <Mic size={16} />
            Parla
          </button>
        )}

        {mode === 'listening' && (
          <button
            onClick={stop}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-red hover:opacity-90 text-white text-xs font-medium transition-colors"
          >
            <MicOff size={16} />
            Stop
          </button>
        )}

        {mode === 'processing' && (
          <div className="flex items-center gap-2 px-4 py-2 text-amber text-xs">
            <Loader2 size={16} className="animate-spin" />
            Invio al sistema...
          </div>
        )}

        {mode === 'speaking' && (
          <button
            onClick={stop}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-green/20 border border-green/30 text-green text-xs font-medium transition-colors hover:bg-green/30"
          >
            <Volume2 size={16} />
            Interrompi
          </button>
        )}
      </div>

      {continuous && mode === 'idle' && (
        <div className="text-[9px] text-gold text-center mt-1">
          Conversazione continua attiva — parla quando vuoi
        </div>
      )}
    </div>
  )
}

function mergeUint8Arrays(arrays: Uint8Array[]): Uint8Array {
  const totalLen = arrays.reduce((sum, a) => sum + a.byteLength, 0)
  const result = new Uint8Array(totalLen)
  let offset = 0
  for (const arr of arrays) {
    result.set(arr, offset)
    offset += arr.byteLength
  }
  return result
}
