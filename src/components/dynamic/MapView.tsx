import { useEffect, useRef, useState } from 'react'

interface MapConfig {
  startField: string
  endField: string
  latField?: string
  lngField?: string
  colorField?: string
  colorEmpty?: string
  colorFilled?: string
  popupFields?: string[]
  labelField?: string
}

interface MapViewProps {
  config: MapConfig
  data: any[]
  title?: string
}

// Geocode cache to avoid repeated API calls
const geocodeCache = new Map<string, [number, number]>()

async function geocode(place: string): Promise<[number, number] | null> {
  if (!place) return null
  const cached = geocodeCache.get(place.toLowerCase())
  if (cached) return cached

  try {
    const res = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(place + ', Italy')}&format=json&limit=1`, {
      headers: { 'User-Agent': 'FIAI-OS/1.0' }
    })
    const data = await res.json()
    if (data?.[0]) {
      const coords: [number, number] = [parseFloat(data[0].lat), parseFloat(data[0].lon)]
      geocodeCache.set(place.toLowerCase(), coords)
      return coords
    }
  } catch {}
  return null
}

export default function MapView({ config, data, title }: MapViewProps) {
  const mapRef = useRef<HTMLDivElement>(null)
  const mapInstance = useRef<any>(null)
  const [loading, setLoading] = useState(true)
  const [geocoded, setGeocoded] = useState(0)

  useEffect(() => {
    if (!mapRef.current || mapInstance.current) return

    import('leaflet').then(async (L) => {
      // Add CSS if not present
      if (!document.getElementById('leaflet-css')) {
        const link = document.createElement('link')
        link.id = 'leaflet-css'
        link.rel = 'stylesheet'
        link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css'
        document.head.appendChild(link)
      }

      // Create map centered on Italy
      const map = L.map(mapRef.current!, { zoomControl: true })
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 18,
        attribution: '&copy; OpenStreetMap'
      }).addTo(map)

      mapInstance.current = map

      // Geocode and add markers
      const bounds: [number, number][] = []
      let count = 0

      for (const item of data) {
        const startName = item[config.startField]
        const endName = item[config.endField]
        const colorValue = config.colorField ? item[config.colorField] : null
        const markerColor = colorValue ? (config.colorFilled || '#2D8B56') : (config.colorEmpty || '#D32F2F')

        // Build popup content
        const popupLines = (config.popupFields || []).map(f => {
          const val = item[f]
          return val ? `<b>${f}:</b> ${val}` : null
        }).filter(Boolean)
        const popupHtml = popupLines.join('<br>') || JSON.stringify(item).substring(0, 200)

        // Geocode start
        const startCoords = await geocode(startName)
        if (startCoords) {
          const icon = L.divIcon({
            html: `<div style="background:${markerColor};width:12px;height:12px;border-radius:50%;border:2px solid white;box-shadow:0 1px 3px rgba(0,0,0,.3)"></div>`,
            iconSize: [12, 12],
            className: ''
          })
          L.marker(startCoords, { icon }).addTo(map).bindPopup(`<div style="font-size:11px">${popupHtml}</div>`)
          bounds.push(startCoords)
        }

        // Geocode end and draw line
        const endCoords = await geocode(endName)
        if (startCoords && endCoords) {
          L.polyline([startCoords, endCoords], {
            color: markerColor,
            weight: 2,
            opacity: 0.6,
            dashArray: colorValue ? '' : '5,5'
          }).addTo(map)

          // End marker (smaller)
          const endIcon = L.divIcon({
            html: `<div style="background:${markerColor};width:8px;height:8px;border-radius:50%;border:1.5px solid white"></div>`,
            iconSize: [8, 8],
            className: ''
          })
          L.marker(endCoords, { icon: endIcon }).addTo(map)
          bounds.push(endCoords)
        }

        count++
        setGeocoded(count)
      }

      // Fit bounds
      if (bounds.length > 0) {
        map.fitBounds(bounds, { padding: [30, 30] })
      } else {
        map.setView([42.5, 12.5], 6) // Italy center
      }

      setLoading(false)
    })

    return () => {
      if (mapInstance.current) {
        mapInstance.current.remove()
        mapInstance.current = null
      }
    }
  }, [data, config])

  return (
    <div className="h-full flex flex-col">
      {loading && (
        <div className="text-xs text-text3 px-3 py-2 bg-bg3 rounded-t-lg">
          Geocoding {geocoded}/{data.length} localita'...
        </div>
      )}
      <div ref={mapRef} className="flex-1 min-h-[400px] rounded-lg overflow-hidden border border-border" />
      <div className="text-[10px] text-text3 mt-1 px-1">
        {data.length} record · {config.colorField && (
          <span>
            <span style={{ color: config.colorFilled || '#2D8B56' }}>●</span> assegnato
            <span className="mx-1">·</span>
            <span style={{ color: config.colorEmpty || '#D32F2F' }}>●</span> non assegnato
          </span>
        )}
      </div>
    </div>
  )
}
