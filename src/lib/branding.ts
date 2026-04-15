/**
 * Dynamic Branding — loads company name and colors from the backend
 * and applies CSS custom properties for runtime theming.
 */

export interface Branding {
  name: string
  short_name: string
  color: string
}

let branding: Branding = { name: 'FIAI OS', short_name: 'FIAI', color: '#C41E3A' }

/**
 * Darken a hex color by a percentage (0-1)
 */
function darkenHex(hex: string, amount: number): string {
  const num = parseInt(hex.replace('#', ''), 16)
  const r = Math.max(0, Math.floor((num >> 16) * (1 - amount)))
  const g = Math.max(0, Math.floor(((num >> 8) & 0xFF) * (1 - amount)))
  const b = Math.max(0, Math.floor((num & 0xFF) * (1 - amount)))
  return `#${(r << 16 | g << 8 | b).toString(16).padStart(6, '0')}`
}

/**
 * Lighten a hex color by a percentage (0-1)
 */
function lightenHex(hex: string, amount: number): string {
  const num = parseInt(hex.replace('#', ''), 16)
  const r = Math.min(255, Math.floor((num >> 16) + (255 - (num >> 16)) * amount))
  const g = Math.min(255, Math.floor(((num >> 8) & 0xFF) + (255 - ((num >> 8) & 0xFF)) * amount))
  const b = Math.min(255, Math.floor((num & 0xFF) + (255 - (num & 0xFF)) * amount))
  return `#${(r << 16 | g << 8 | b).toString(16).padStart(6, '0')}`
}

/**
 * Load branding from backend and apply CSS variables
 */
export async function loadBranding(): Promise<Branding> {
  try {
    const res = await fetch('/api/branding')
    if (res.ok) {
      const data = await res.json()
      branding = {
        name: data.name || 'FIAI OS',
        short_name: data.short_name || data.name || 'FIAI',
        color: data.color || '#C41E3A',
      }
    }
  } catch {}

  // Apply CSS custom properties
  const root = document.documentElement
  root.style.setProperty('--brand-color', branding.color)
  root.style.setProperty('--brand-color-light', lightenHex(branding.color, 0.2))
  root.style.setProperty('--brand-color-dark', darkenHex(branding.color, 0.3))

  // Update page title
  document.title = `${branding.short_name} OS`

  return branding
}

export function getBranding(): Branding {
  return branding
}
