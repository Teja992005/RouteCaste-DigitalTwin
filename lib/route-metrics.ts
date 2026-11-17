/**
 * Metrics for the active route, each tagged with where its number came from so
 * the dashboard never presents an estimate as a measurement.
 *
 *  - With a simulated event and a prediction for this route, speed, arrival,
 *    congestion and delay come from that prediction ("model" when the ONNX
 *    models produced it, otherwise "estimate").
 *  - Without one, speed and arrival come from the OSRM route (free-flow, no
 *    traffic) and congestion from the route-intelligence score when present.
 *  - CO2 and fuel are fixed per-km factors scaled by congestion: estimates.
 *  - Air quality is ambient data supplied by the caller; it is not derived from
 *    traffic or events.
 */

import type { EventImpactRoute } from "@/lib/types"

export type MetricSource = "model" | "osrm" | "intel" | "estimate" | "cams"

export type RouteMetrics = {
  avgSpeedKmh: number
  /** 0..1 */
  congestionIndex: number
  avgArrivalMin: number
  /** Extra minutes caused by the simulated events on this route; null when no prediction exists. */
  eventDelayMin: number | null
  activeIncidents: number
  /** Ambient US AQI; null when no data. */
  aqi: number | null
  co2Kg: number
  fuelL: number
  sources: {
    speed: MetricSource
    congestion: MetricSource
    arrival: MetricSource
    delay: MetricSource
    incidents: MetricSource
    aqi: MetricSource
    co2: MetricSource
    fuel: MetricSource
  }
}

export type RouteMetricsInput = {
  /** Active OSRM route; null when none is selected. */
  route: { distanceMeters: number; durationSeconds: number } | null
  /** This route's prediction from /api/event/simulate, when an event is simulated. */
  simulated: EventImpactRoute | null
  /** Route-intelligence congestion score, 0..100, when available. */
  intelCongestionPct: number | null
  incidentCount: number
  aqi: number | null
}

export const CO2_KG_PER_KM = 0.21
export const FUEL_L_PER_KM = 0.08
/** Extra consumption at full congestion (stop-and-go). */
export const CONGESTION_CONSUMPTION_FACTOR = 0.6

const round1 = (value: number) => Math.round(value * 10) / 10
const clamp01 = (value: number) => Math.max(0, Math.min(1, value))

export function computeRouteMetrics(input: RouteMetricsInput): RouteMetrics {
  const distKm = input.route ? input.route.distanceMeters / 1000 : 5
  const osrmMin = input.route ? input.route.durationSeconds / 60 : 10
  const sim = input.simulated

  let arrivalMin = osrmMin
  let avgSpeedKmh: number
  let congestionIndex: number
  let eventDelayMin: number | null = null
  let speedSource: MetricSource = "osrm"
  let congestionSource: MetricSource
  let delaySource: MetricSource = "estimate"

  if (sim) {
    const fromModel = sim.source === "model"
    arrivalMin = sim.eventEtaMin
    eventDelayMin = sim.etaDeltaMin
    congestionIndex = clamp01(sim.congestionDuring)
    speedSource = fromModel ? "model" : "estimate"
    congestionSource = fromModel ? "model" : "estimate"
    delaySource = fromModel ? "model" : "estimate"
  } else {
    congestionIndex = 0
    congestionSource = "estimate"
  }

  avgSpeedKmh = arrivalMin > 0 ? Math.round(distKm / (arrivalMin / 60)) : 0

  if (!sim) {
    if (input.intelCongestionPct !== null && Number.isFinite(input.intelCongestionPct)) {
      congestionIndex = clamp01(input.intelCongestionPct / 100)
      congestionSource = "intel"
    } else {
      congestionIndex = clamp01(1 - avgSpeedKmh / 50)
      congestionSource = "estimate"
    }
  }

  const multiplier = 1 + congestionIndex * CONGESTION_CONSUMPTION_FACTOR
  return {
    avgSpeedKmh,
    congestionIndex,
    avgArrivalMin: Math.round(arrivalMin),
    eventDelayMin,
    activeIncidents: input.incidentCount,
    aqi: input.aqi,
    co2Kg: round1(distKm * CO2_KG_PER_KM * multiplier),
    fuelL: round1(distKm * FUEL_L_PER_KM * multiplier),
    sources: {
      speed: speedSource,
      congestion: congestionSource,
      arrival: sim ? speedSource : "osrm",
      delay: delaySource,
      incidents: "intel",
      aqi: "cams",
      co2: "estimate",
      fuel: "estimate",
    },
  }
}
