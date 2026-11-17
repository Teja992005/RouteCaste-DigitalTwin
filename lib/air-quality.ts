/**
 * Ambient air quality from the Open-Meteo Air Quality API (free, no API key).
 *
 * The values are modelled by the Copernicus Atmosphere Monitoring Service
 * (CAMS) on a regional grid. They describe the background air over the area,
 * not street-level conditions, and they do NOT react to a simulated event.
 * Open-Meteo requires attribution to CAMS and Open-Meteo (shown in the UI).
 */

const BASE = process.env.AIR_QUALITY_API_URL?.trim() || "https://air-quality-api.open-meteo.com/v1/air-quality"
const TIMEOUT_MS = 6000

export type AmbientAqi = {
  /** US AQI, 0..500. */
  aqi: number
  /** PM2.5 in µg/m³, when the API returned it. */
  pm25: number | null
  /** Observation time reported by the API, when present. */
  time: string | null
}

/** US AQI category (EPA breakpoints). */
export function aqiCategory(aqi: number): "Good" | "Moderate" | "Unhealthy for sensitive groups" | "Unhealthy" | "Very unhealthy" | "Hazardous" {
  if (aqi <= 50) return "Good"
  if (aqi <= 100) return "Moderate"
  if (aqi <= 150) return "Unhealthy for sensitive groups"
  if (aqi <= 200) return "Unhealthy"
  if (aqi <= 300) return "Very unhealthy"
  return "Hazardous"
}

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

/** Reads `current.us_aqi` from an Open-Meteo response; null when it is missing or invalid. */
export function parseAmbientAqi(payload: unknown): AmbientAqi | null {
  if (!payload || typeof payload !== "object") return null
  const current = (payload as { current?: Record<string, unknown> }).current
  if (!current || typeof current !== "object") return null
  const aqi = finite(current.us_aqi)
  if (aqi === null || aqi < 0 || aqi > 500) return null
  return {
    aqi: Math.round(aqi),
    pm25: finite(current.pm2_5),
    time: typeof current.time === "string" ? current.time : null,
  }
}

/** Fetches ambient AQI for a point. Returns null on any failure; never throws. */
export async function fetchAmbientAqi(
  lat: number,
  lng: number,
  fetchImpl: typeof fetch = fetch,
): Promise<AmbientAqi | null> {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
  const url = `${BASE}?latitude=${lat}&longitude=${lng}&current=us_aqi,pm2_5&timezone=auto`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const response = await fetchImpl(url, { signal: controller.signal, headers: { Accept: "application/json" } })
    if (!response.ok) return null
    return parseAmbientAqi(await response.json())
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}
