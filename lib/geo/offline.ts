// Offline fallbacks used when a public service (OSRM, Nominatim, Overpass) is
// down, rate-limited or unreachable. They are built from data shipped with the
// app: the OpenStreetMap-derived Guntur road graph and the Guntur landmark
// list. Results are always labelled so they are never mistaken for live data.

import { GUNTUR_PLACES } from "@/lib/guntur-places"
import { haversineM, routeOnGraph } from "@/lib/guntur-graph"
import type { GeoPlace } from "@/lib/geo/geocoder"
import type { EngineRoute, LonLat, TravelMode } from "@/lib/geo/routing"
import type { Poi } from "@/lib/geo/places"

const MODE_SPEED_KMH: Record<TravelMode, number> = { driving: 0, walking: 4.8, cycling: 15 }

/** Route through the local Guntur graph, chaining waypoints. Null if any leg is outside it. */
export function offlineRoute(origin: LonLat, destination: LonLat, waypoints: LonLat[], mode: TravelMode): EngineRoute | null {
  const stops = [origin, ...waypoints, destination]
  const latLngs: [number, number][] = []
  const steps: EngineRoute["steps"] = []
  let distance = 0
  let duration = 0
  for (let i = 0; i < stops.length - 1; i++) {
    const leg = routeOnGraph(stops[i], stops[i + 1])
    if (!leg) return null
    latLngs.push(...(latLngs.length ? leg.latLngs.slice(1) : leg.latLngs))
    distance += leg.distanceM
    duration += leg.durationSec
    for (const s of leg.steps) {
      steps.push({
        instruction: s.name ? `Continue on ${s.name}` : "Continue",
        maneuver: "continue",
        name: s.name,
        distanceMeters: Math.round(s.distanceM),
        durationSeconds: Math.round(s.durationSec),
      })
    }
  }
  if (steps.length) steps[steps.length - 1].instruction = "Arrive at destination"
  const speed = MODE_SPEED_KMH[mode]
  if (speed > 0) duration = (distance / 1000 / speed) * 3600
  const named = Array.from(new Set(steps.map((s) => s.name).filter(Boolean))).slice(0, 2)
  return {
    id: "route_1",
    distanceMeters: Math.round(distance),
    durationSeconds: Math.round(duration),
    geometry: { type: "LineString", coordinates: latLngs.map(([la, ln]) => [ln, la] as [number, number]) },
    latLngs,
    steps,
    summary: named.join(" / "),
    aiScore: null,
  }
}

// ---------- geocoding ----------

function toGeoPlace(p: (typeof GUNTUR_PLACES)[number]): GeoPlace {
  return {
    id: `local:${p.id}`,
    name: p.name,
    address: `${p.name}, Guntur, Andhra Pradesh, India`,
    lat: p.lat,
    lon: p.lng,
    type: p.type,
    region: "Andhra Pradesh",
    country: "India",
  }
}

/** Case-insensitive match on the local Guntur landmark list. */
export function offlineSearchPlaces(query: string, limit = 6): GeoPlace[] {
  const q = query.trim().toLowerCase()
  if (q.length < 2) return []
  const words = q.split(/\s+/)
  return GUNTUR_PLACES.filter((p) => {
    const hay = `${p.name} ${p.description} guntur`.toLowerCase()
    return words.every((w) => hay.includes(w))
  })
    .slice(0, limit)
    .map(toGeoPlace)
}

/** Nearest known landmark within `maxM`, or null. */
export function offlineReverse(lat: number, lon: number, maxM = 1500): GeoPlace | null {
  let best: (typeof GUNTUR_PLACES)[number] | null = null
  let bestD = Infinity
  for (const p of GUNTUR_PLACES) {
    const d = haversineM(lat, lon, p.lat, p.lng)
    if (d < bestD) {
      bestD = d
      best = p
    }
  }
  return best && bestD <= maxM ? toGeoPlace(best) : null
}

// ---------- nearby places ----------

/** POI category -> local landmark types that can answer it. */
const CATEGORY_TYPES: Record<string, string[]> = {
  hospital: ["hospital"],
  university: ["education"],
  government: ["government"],
  attraction: ["landmark"],
  shopping: ["commercial"],
}

export function offlinePois(category: string, categoryLabel: string, lat: number, lon: number, radius: number, limit: number): Poi[] {
  const types = CATEGORY_TYPES[category]
  if (!types) return []
  return GUNTUR_PLACES.filter((p) => types.includes(p.type))
    .map((p) => ({
      id: `local:${p.id}`,
      name: p.name,
      category,
      categoryLabel,
      lat: p.lat,
      lon: p.lng,
      distanceMeters: Math.round(haversineM(lat, lon, p.lat, p.lng)),
      address: `${p.name}, Guntur`,
    }))
    .filter((p) => p.distanceMeters <= radius)
    .sort((a, b) => a.distanceMeters - b.distanceMeters)
    .slice(0, limit)
}
