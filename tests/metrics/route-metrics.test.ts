import { describe, expect, it } from "vitest"
import { aqiCategory, fetchAmbientAqi, parseAmbientAqi } from "@/lib/air-quality"
import { computeRouteMetrics } from "@/lib/route-metrics"
import type { EventImpactRoute } from "@/lib/types"

const route = { distanceMeters: 5000, durationSeconds: 600 } // 5 km, 10 min free-flow

function simRoute(overrides: Partial<EventImpactRoute> = {}): EventImpactRoute {
  return {
    routeId: "r1",
    label: "Route 1",
    baseEtaMin: 21.1,
    eventEtaMin: 42.1,
    etaDeltaMin: 21,
    congestionBefore: 0.75,
    congestionDuring: 1,
    congestionClass: "severe",
    affected: true,
    recommended: false,
    reason: "",
    source: "model",
    ...overrides,
  }
}

const base = { route, simulated: null, intelCongestionPct: null, incidentCount: 0, aqi: null }

describe("computeRouteMetrics without a simulation", () => {
  it("uses the OSRM route for speed and arrival and tags them osrm", () => {
    const m = computeRouteMetrics(base)
    expect(m.avgSpeedKmh).toBe(30) // 5 km in 10 min
    expect(m.avgArrivalMin).toBe(10)
    expect(m.sources.speed).toBe("osrm")
    expect(m.sources.arrival).toBe("osrm")
    expect(m.eventDelayMin).toBeNull()
  })

  it("takes congestion from the intelligence score when present", () => {
    const m = computeRouteMetrics({ ...base, intelCongestionPct: 64 })
    expect(m.congestionIndex).toBeCloseTo(0.64, 6)
    expect(m.sources.congestion).toBe("intel")
  })

  it("falls back to a speed-derived estimate and says so", () => {
    const m = computeRouteMetrics(base)
    expect(m.congestionIndex).toBeCloseTo(1 - 30 / 50, 6)
    expect(m.sources.congestion).toBe("estimate")
  })

  it("does not invent an incident or an AQI", () => {
    const m = computeRouteMetrics(base)
    expect(m.activeIncidents).toBe(0)
    expect(m.aqi).toBeNull()
  })
})

describe("computeRouteMetrics with a simulated route", () => {
  it("uses the model's event ETA, congestion and delay", () => {
    const m = computeRouteMetrics({ ...base, simulated: simRoute() })
    expect(m.avgArrivalMin).toBe(42)
    expect(m.avgSpeedKmh).toBe(Math.round(5 / (42.1 / 60)))
    expect(m.congestionIndex).toBe(1)
    expect(m.eventDelayMin).toBe(21)
    expect(m.sources).toMatchObject({ speed: "model", congestion: "model", arrival: "model", delay: "model" })
  })

  it("tags heuristic predictions as estimates", () => {
    const m = computeRouteMetrics({ ...base, simulated: simRoute({ source: "heuristic" }) })
    expect(m.sources).toMatchObject({ speed: "estimate", congestion: "estimate", arrival: "estimate", delay: "estimate" })
  })

  it("ignores the intelligence score when a prediction exists", () => {
    const m = computeRouteMetrics({ ...base, simulated: simRoute({ congestionDuring: 0.5 }), intelCongestionPct: 90 })
    expect(m.congestionIndex).toBe(0.5)
  })
})

describe("computeRouteMetrics emissions", () => {
  it("scales CO2 and fuel by congestion and tags them as estimates", () => {
    const calm = computeRouteMetrics({ ...base, simulated: simRoute({ congestionDuring: 0, eventEtaMin: 10 }) })
    const jam = computeRouteMetrics({ ...base, simulated: simRoute({ congestionDuring: 1 }) })
    expect(calm.co2Kg).toBe(1.1) // 5 km × 0.21 kg/km = 1.05, rounded to one decimal
    expect(jam.co2Kg).toBe(1.7) // × 1.6 at full congestion = 1.68
    expect(jam.fuelL).toBeGreaterThan(calm.fuelL)
    expect(jam.sources.co2).toBe("estimate")
    expect(jam.sources.fuel).toBe("estimate")
  })
})

describe("computeRouteMetrics passes through ambient data", () => {
  it("keeps the AQI as given and tags it cams", () => {
    const m = computeRouteMetrics({ ...base, aqi: 87, incidentCount: 2 })
    expect(m.aqi).toBe(87)
    expect(m.sources.aqi).toBe("cams")
    expect(m.activeIncidents).toBe(2)
  })

  it("AQI does not change when an event is simulated", () => {
    const quiet = computeRouteMetrics({ ...base, aqi: 87 })
    const busy = computeRouteMetrics({ ...base, aqi: 87, simulated: simRoute() })
    expect(busy.aqi).toBe(quiet.aqi)
  })
})

describe("parseAmbientAqi", () => {
  it("reads us_aqi and pm2_5", () => {
    expect(parseAmbientAqi({ current: { time: "2026-11-15T12:00", us_aqi: 87.4, pm2_5: 31.2 } })).toEqual({
      aqi: 87,
      pm25: 31.2,
      time: "2026-11-15T12:00",
    })
  })
  it("returns null for missing, non-numeric or out-of-range values", () => {
    expect(parseAmbientAqi(null)).toBeNull()
    expect(parseAmbientAqi({})).toBeNull()
    expect(parseAmbientAqi({ current: {} })).toBeNull()
    expect(parseAmbientAqi({ current: { us_aqi: "87" } })).toBeNull()
    expect(parseAmbientAqi({ current: { us_aqi: -3 } })).toBeNull()
    expect(parseAmbientAqi({ current: { us_aqi: 900 } })).toBeNull()
  })
  it("tolerates a missing pm2_5", () => {
    expect(parseAmbientAqi({ current: { us_aqi: 40 } })).toEqual({ aqi: 40, pm25: null, time: null })
  })
})

describe("fetchAmbientAqi", () => {
  const ok = (body: unknown) => (async () => new Response(JSON.stringify(body), { status: 200 })) as unknown as typeof fetch

  it("returns the parsed value on success and calls the right endpoint", async () => {
    let seen = ""
    const fake = (async (url: string) => {
      seen = url
      return new Response(JSON.stringify({ current: { us_aqi: 62, pm2_5: 20 } }), { status: 200 })
    }) as unknown as typeof fetch
    expect(await fetchAmbientAqi(16.3067, 80.4365, fake)).toMatchObject({ aqi: 62 })
    expect(seen).toContain("latitude=16.3067")
    expect(seen).toContain("longitude=80.4365")
    expect(seen).toContain("us_aqi")
  })
  it("returns null on a non-OK response", async () => {
    const fake = (async () => new Response("nope", { status: 500 })) as unknown as typeof fetch
    expect(await fetchAmbientAqi(16.3, 80.4, fake)).toBeNull()
  })
  it("returns null when the network fails", async () => {
    const fake = (async () => {
      throw new Error("offline")
    }) as unknown as typeof fetch
    expect(await fetchAmbientAqi(16.3, 80.4, fake)).toBeNull()
  })
  it("returns null for an unusable payload and for bad coordinates", async () => {
    expect(await fetchAmbientAqi(16.3, 80.4, ok({ current: {} }))).toBeNull()
    expect(await fetchAmbientAqi(Number.NaN, 80.4, ok({ current: { us_aqi: 50 } }))).toBeNull()
  })
})

describe("aqiCategory", () => {
  it("follows the US EPA breakpoints", () => {
    expect(aqiCategory(50)).toBe("Good")
    expect(aqiCategory(51)).toBe("Moderate")
    expect(aqiCategory(101)).toBe("Unhealthy for sensitive groups")
    expect(aqiCategory(151)).toBe("Unhealthy")
    expect(aqiCategory(201)).toBe("Very unhealthy")
    expect(aqiCategory(301)).toBe("Hazardous")
  })
})
