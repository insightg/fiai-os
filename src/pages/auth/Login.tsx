import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '../../store'
import { Input } from '../../components/ui/Form'
import Button from '../../components/ui/Button'

export default function Login() {
  const [account, setAccount] = useState('')
  const [password, setPassword] = useState('')
  const login = useAuthStore((s) => s.login)
  const loading = useAuthStore((s) => s.loading)
  const error = useAuthStore((s) => s.error)
  const navigate = useNavigate()

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    await login(account, password)
    const session = useAuthStore.getState().session
    if (session) {
      navigate('/')
    }
  }

  return (
    <div className="min-h-screen bg-bg flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="font-display text-4xl font-bold text-gold mb-2">BERNARDINI OS</h1>
          <p className="text-text2 text-sm">Gestionale Intelligente</p>
        </div>

        <div className="bg-bg2 border border-border rounded-xl p-8">
          <h2 className="text-xl font-semibold text-text mb-6">Accedi</h2>

          {error && (
            <div className="mb-4 p-3 rounded-lg bg-red/10 border border-red/20 text-red text-sm">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <Input
              label="Account"
              type="text"
              placeholder="nome account"
              value={account}
              onChange={(e) => setAccount(e.target.value)}
              required
            />
            <Input
              label="Password"
              type="password"
              placeholder="La tua password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
            <Button
              type="submit"
              variant="primary"
              size="lg"
              className="w-full mt-2"
              disabled={loading}
            >
              {loading ? 'Accesso in corso...' : 'Accedi'}
            </Button>
          </form>
        </div>

        <p className="text-center text-text3 text-xs mt-6">
          BERNARDINI OS &mdash; Powered by AI FIAI
        </p>
      </div>
    </div>
  )
}
