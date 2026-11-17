"use client"

import useSWR from "swr"
import { useCallback, useEffect, useState } from "react"

export type NavPoint = { lat: number; lon: number; label?: string }
export type TravelMode = "driving" | "walking" | "cycling"

export type NavStep = {
  instruction: string
  maneuver: string
  modifier?: string
  name: string
  distanceMeters: number
  durationSeconds: number
}

export type NavRoute = {
  id: string
  label: string
  distanceMeters: number
  durationSeconds: number
  summary: string
  latLngs: [number, number][]
  steps: NavStep[]
  ai_score: number | null
}

export type NavResponse = {
  engine: string
  mode: TravelMode
  routes: NavRoute[]
  traffic: { source: string; note: string }
}

export type NavigationError = {
  message: string
  code: "timeout" | "rate_limited" | "no_route" | "unknown"
  retryable: boolean
}

export type NavigationErrorWithActions = NavigationError & {
  retry: () => void
  clearError: () => void
}

class RouteRequestError extends Error {
  constructor(readonly navError: NavigationError) {
    super(navError.message)
    this.name = "RouteRequestError"
  }
}

const CACHE_PREFIX = "rc_route_v1:"
const CACHE_MAX_AGE_MS = 10 * 60 * 1000

function readCache(key: string): NavResponse | null {
  try {
    const raw = sessionStorage.getItem(CACHE_PREFIX + key)
    if (!raw) return null
    const { ts, data } = JSON.parse(raw) as { ts: number; data: NavResponse }
    if (Date.now() - ts > CACHE_MAX_AGE_MS) {
      sessionStorage.removeItem(CACHE_PREFIX + key)
      return null
    }
    return data
  } catch {
    return null
  }
}

function writeCache(key: string, data: NavResponse) {
  try {
    sessionStorage.setItem(CACHE_PREFIX + key, JSON.stringify({ ts: Date.now(), data }))
  } catch {
    // Ignore storage quota and privacy-mode failures.
  }
}

async function postRoute(key: string): Promise<NavResponse> {
  const { origin, destination, waypoints, mode } = JSON.parse(key.replace(/^nav:/, ""))
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 15_000)
  try {
    const res = await fetch("/api/navigation/route", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ origin, destination, waypoints, mode, alternatives: true }),
      signal: controller.signal,
    })
    const body = await res.json().catch(() => null) as { error?: unknown } | null
    if (!res.ok) {
      const message = typeof body?.error === "string" ? body.error : "Routing failed — check your connection."
      if (res.status === 429) {
        throw new RouteRequestError({ message: "Routing server is busy — wait a moment and retry.", code: "rate_limited", retryable: true })
      }
      if (res.status === 504) {
        throw new RouteRequestError({ message: "Routing request timed out. The OSRM server may be slow.", code: "timeout", retryable: true })
      }
      if (res.status === 404) {
        throw new RouteRequestError({ message: "No route found between these two points.", code: "no_route", retryable: false })
      }
      throw new RouteRequestError({ message, code: "unknown", retryable: true })
    }
    const result = body as NavResponse
    writeCache(key, result)
    return result
  } catch (error) {
    if (error instanceof RouteRequestError) {
      const cached = readCache(key)
      if (cached) {
        return { ...cached, traffic: { source: "cache", note: "Cached route — OSRM may be rate-limited." } }
      }
      throw error
    }
    if (controller.signal.aborted || (error instanceof Error && error.name === "AbortError")) {
      throw new RouteRequestError({ message: "Routing request timed out. The OSRM server may be slow.", code: "timeout", retryable: true })
    }
    throw new RouteRequestError({
      message: "Routing failed — check your connection.",
      code: "unknown",
      retryable: true,
    })
  } finally {
    clearTimeout(timeout)
  }
}

/** Fetches real routes whenever origin, destination, waypoints or mode change. */
export function useNavigationRoute(
  origin: NavPoint | null,
  destination: NavPoint | null,
  mode: TravelMode,
  waypoints: NavPoint[] = [],
) {
  const key =
    origin && destination
      ? `nav:${JSON.stringify({
          origin: { lat: origin.lat, lon: origin.lon },
          destination: { lat: destination.lat, lon: destination.lon },
          waypoints: waypoints.map((w) => ({ lat: w.lat, lon: w.lon })),
          mode,
        })}`
      : null

  const { data, error, isLoading, mutate } = useSWR<NavResponse>(key, postRoute, {
    revalidateOnFocus: false,
    shouldRetryOnError: false,
  })

  const [navError, setNavError] = useState<NavigationError | null>(null)
  useEffect(() => {
    setNavError(null)
  }, [key])
  useEffect(() => {
    if (!error) return
    if (error instanceof RouteRequestError) {
      setNavError(error.navError)
    } else {
      setNavError({
        message: error instanceof Error && error.message ? error.message : "Routing failed — check your connection.",
        code: "unknown",
        retryable: true,
      })
    }
  }, [error])

  const triggerRoute = useCallback(() => {
    setNavError(null)
    void mutate()
  }, [mutate])
  const clearError = useCallback(() => setNavError(null), [])
  const errorWithActions: NavigationErrorWithActions | null = navError
    ? { ...navError, retry: triggerRoute, clearError }
    : null
  const isFromCache = data?.traffic?.source === "cache"

  return {
    routes: data?.routes ?? [],
    engine: data?.engine,
    trafficNote: data?.traffic?.note,
    loading: isLoading,
    error: errorWithActions,
    isFromCache,
    retry: triggerRoute,
    clearError,
  }
}
