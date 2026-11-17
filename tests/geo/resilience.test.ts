import { describe, expect, it, vi } from "vitest"
import { ResilientEngine, RoutingError, type EngineRoute, type RoutingEngine, type RouteResult } from "@/lib/geo/routing"
import { offlinePois, offlineReverse, offlineSearchPlaces } from "@/lib/geo/offline"
import { buildGraph, routeOnGraph } from "@/lib/guntur-graph"

const A = { lat: 16.3, lon: 80.4 }
const B = { lat: 16.302, lon: 80.4 }
const input = { origin: A, destination: B, mode: "driving" as const }

const okRoute: EngineRoute = {
  id: "route_1",
  distanceMeters: 100,
  durationSeconds: 10,
  geometry: { type: "LineString", coordinates: [] },
  latLngs: [],
  steps: [],
  summary: "",
  aiScore: null,
}
const live: RouteResult = { engine: "osrm", mode: "driving", routes: [okRoute] }

function primary(impl: () => Promise<RouteResult>): RoutingEngine & { calls: number } {
  const e = { name: "osrm", calls: 0, route: async () => (e.calls++, impl()) }
  return e
}

describe("ResilientEngine", () => {
  it("passes a healthy primary result straight through", async () => {
    const p = primary(async () => live)
    const offline = vi.fn(() => okRoute)
    const r = await new ResilientEngine(p, offline, 0).route(input)
    expect(r).toBe(live)
    expect(offline).not.toHaveBeenCalled()
  })

  it("retries once and succeeds without falling back", async () => {
    let n = 0
    const p = primary(async () => {
      if (n++ === 0) throw new RoutingError("routing engine timed out", 504)
      return live
    })
    const offline = vi.fn(() => okRoute)
    const r = await new ResilientEngine(p, offline, 0).route(input)
    expect(r.engine).toBe("osrm")
    expect(p.calls).toBe(2)
    expect(offline).not.toHaveBeenCalled()
  })

  it("falls back offline after two transient failures and says why", async () => {
    const p = primary(async () => {
      throw new RoutingError("routing engine responded 502", 502)
    })
    const r = await new ResilientEngine(p, () => okRoute, 0).route(input)
    expect(p.calls).toBe(2)
    expect(r.engine).toContain("offline")
    expect(r.routes).toEqual([okRoute])
    expect(r.degraded).toMatch(/502/)
  })

  it("never masks bad input or no-route answers", async () => {
    for (const status of [400, 404]) {
      const p = primary(async () => {
        throw new RoutingError("nope", status)
      })
      const offline = vi.fn(() => okRoute)
      await expect(new ResilientEngine(p, offline, 0).route(input)).rejects.toThrow("nope")
      expect(p.calls).toBe(1)
      expect(offline).not.toHaveBeenCalled()
    }
  })

  it("rethrows the original error when the offline graph cannot cover the trip", async () => {
    const p = primary(async () => {
      throw new RoutingError("routing engine timed out", 504)
    })
    await expect(new ResilientEngine(p, () => null, 0).route(input)).rejects.toThrow("timed out")
  })

  it("marks non-driving offline durations as estimated", async () => {
    const p = primary(async () => {
      throw new RoutingError("down", 503)
    })
    const r = await new ResilientEngine(p, () => okRoute, 0).route({ ...input, mode: "walking" })
    expect(r.durationEstimated).toBe(true)
  })
})

describe("routeOnGraph", () => {
  const nodes = [
    { node_id: "A", latitude: "16.3000", longitude: "80.4000" },
    { node_id: "B", latitude: "16.3010", longitude: "80.4000" },
    { node_id: "C", latitude: "16.3020", longitude: "80.4000" },
  ]
  const road = (id: string, from: string, to: string, name: string) => {
    const a = nodes.find((n) => n.node_id === from)!
    const b = nodes.find((n) => n.node_id === to)!
    return {
      road_id: id, road_name: name, from_node: from, to_node: to, length_m: "110", road_type: "residential",
      free_flow_time_sec: "10", capacity_vph: "700",
      geometry_wkt: `LINESTRING (${a.longitude} ${a.latitude}, ${b.longitude} ${b.latitude})`,
    }
  }
  const g = buildGraph([road("AB", "A", "B", "Main Road"), road("BC", "B", "C", "Main Road")], nodes, [])

  it("routes along the directed graph, merging same-name roads into one step", () => {
    const r = routeOnGraph({ lat: 16.3, lon: 80.4 }, { lat: 16.302, lon: 80.4 }, g)!
    expect(r.steps).toHaveLength(1)
    expect(r.steps[0].name).toBe("Main Road")
    expect(r.distanceM).toBeGreaterThan(219)
    expect(r.durationSec).toBeGreaterThan(19)
    expect(r.latLngs[0]).toEqual([16.3, 80.4])
    expect(r.latLngs[r.latLngs.length - 1]).toEqual([16.302, 80.4])
  })
  it("returns null against the one-way direction", () => {
    expect(routeOnGraph({ lat: 16.302, lon: 80.4 }, { lat: 16.3, lon: 80.4 }, g)).toBeNull()
  })
  it("returns null when an endpoint is outside the graph", () => {
    expect(routeOnGraph({ lat: 17.385, lon: 78.4867 }, { lat: 16.302, lon: 80.4 }, g)).toBeNull()
    expect(routeOnGraph({ lat: 16.3, lon: 80.4 }, { lat: 16.302, lon: 80.4 }, null)).toBeNull()
  })
})

describe("local Guntur fallbacks", () => {
  it("finds landmarks by name", () => {
    const r = offlineSearchPlaces("bus stand")
    expect(r[0].name).toMatch(/Bus Stand/i)
    expect(r[0].id.startsWith("local:")).toBe(true)
  })
  it("returns nothing for gibberish or short queries", () => {
    expect(offlineSearchPlaces("zzzzqq")).toEqual([])
    expect(offlineSearchPlaces("a")).toEqual([])
  })
  it("reverse-geocodes near a landmark but not far away", () => {
    expect(offlineReverse(16.3085, 80.4329)?.name).toMatch(/Bus Stand/i)
    expect(offlineReverse(17.385, 78.4867)).toBeNull()
  })
  it("lists local hospitals within the radius, nearest first", () => {
    const pois = offlinePois("hospital", "Hospitals", 16.3012, 80.4, 5000, 10)
    expect(pois.length).toBeGreaterThan(0)
    expect(pois.every((p) => p.distanceMeters <= 5000)).toBe(true)
    const d = pois.map((p) => p.distanceMeters)
    expect(d).toEqual([...d].sort((a, b) => a - b))
    expect(offlinePois("airport", "Airports", 16.3, 80.4, 5000, 10)).toEqual([])
  })
})
