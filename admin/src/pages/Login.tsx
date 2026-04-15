import { useState } from 'react'
import { useAdminStore } from '../store'

export function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const login = useAdminStore(s => s.login)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    const ok = await login(email, password)
    if (!ok) setError('Credenziali non valide')
  }

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-red-500">FIAI OS</h1>
          <p className="text-gray-500 text-sm mt-1">Platform Administration</p>
        </div>
        <form onSubmit={handleSubmit} className="bg-gray-900 border border-gray-800 rounded-xl p-6 space-y-4">
          {error && <div className="text-red-400 text-sm bg-red-900/20 border border-red-800/30 rounded-lg p-2">{error}</div>}
          <div>
            <label className="text-xs text-gray-400 mb-1 block">Email</label>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} required
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:border-red-500 focus:outline-none" />
          </div>
          <div>
            <label className="text-xs text-gray-400 mb-1 block">Password</label>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)} required
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:border-red-500 focus:outline-none" />
          </div>
          <button type="submit" className="w-full bg-red-600 hover:bg-red-700 text-white font-medium py-2 rounded-lg text-sm">Accedi</button>
        </form>
      </div>
    </div>
  )
}
