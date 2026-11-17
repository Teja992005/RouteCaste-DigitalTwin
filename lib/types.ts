/**
 * Shared TypeScript types for the RouteCast API layer.
 *
 * These types describe real-road responses (OSRM routing + ML intel).
 * Grid/synthetic-city types (CityNode, Route, EventPlan, Incident via nodeId,
 * CityMetrics, PollutionZone, ForecastPoint) have been removed with the
 * cleanup of the 8×8 grid system.
 */

// ---------------------------------------------------------------------------
// Event scheduler types (new — replaces the grid "EventPlan")
// ---------------------------------------------------------------------------

export type EventType =
  | "festival"
  | "sports"
  | "concert"
  | "protest"
  | "construction"
  | "vip_visit"
  | "public_gathering"
  | "other"

export type ScheduledEvent = {
  id: string
  name: string
  type: EventType
  lat: number
  lng: number
  locationName: string
  /** ISO 8601 datetime string */
  startTime: string
  /** ISO 8601 datetime string */
  endTime: string
  /** Expected number of attendees */
  attendance: number
  /** 0..1 — computed from attendance + area density */
  eventLoad: number
  /** Meters — affected radius around event location */
  impactRadiusMeters: number
}

// ---------------------------------------------------------------------------
// Event simulation response (from /api/event/simulate)
// ---------------------------------------------------------------------------

export type EventImpactRoute = {
  routeId: string
  label: string
  baseEtaMin: number
  eventEtaMin: number
  etaDeltaMin: number
  congestionBefore: number
  congestionDuring: number
  congestionClass: string
  affected: boolean
  recommended: boolean
  reason: string
  source: "model" | "heuristic"
  /** Names of the events that load this route at the evaluated time. */
  affectedBy?: string[]
  /** Which inputs drove the event delay (Shapley attribution on the ETA model). Absent for heuristic or unaffected routes. */
  explanation?: {
    freeFlowMin: number
    normalTrafficMin: number
    totalDelayMin: number
    drivers: { id: string; label: string; minutes: number; share: number }[]
  }
}

export type EventSimulationResponse = {
  /** The first (or focused) event. */
  event: ScheduledEvent
  /** Every event combined in this simulation, in request order. */
  events?: ScheduledEvent[]
  routes: EventImpactRoute[]
  /** Forecast of congestion across the simulation time window */
  forecast: { minutesFromStart: number; congestion: number; label: string }[]
  /** Most affected road area (approximate centroid) */
  hotspot: { lat: number; lng: number; severityLabel: string } | null
  /** ISO time of peak congestion */
  peakAt: string
  simulatedAt: string
  source: "model" | "heuristic"
  note: string
  /**
   * When the per-route predictions were evaluated. "event-peak" is the default
   * view; "time-slider" means the caller supplied an hour and `eventIntensity`
   * is the event phase at that hour (0 = event not running).
   */
  evaluation?: { hour: number; eventIntensity: number; basis: "event-peak" | "time-slider" }
}

// ---------------------------------------------------------------------------
// Scenario / quick-sim types (for WhatIfPanel — real roads)
// ---------------------------------------------------------------------------

export type ScenarioType =
  | "none"
  | "closure"
  | "accident"
  | "traffic"
  | "rain"
  | "flood"

// ---------------------------------------------------------------------------
// Re-exports from the intel hook (avoids deep imports in components)
// ---------------------------------------------------------------------------

export type { Intel, IntelResponse, IntelScenarioType } from "@/hooks/use-route-intel"
