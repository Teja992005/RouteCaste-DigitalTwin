import { describe, expect, it } from "vitest"
import {
  BPR,
  PEAK_HOUR_SHARE,
  VEHICLES_PER_ATTENDEE,
  baselineProfile,
  bprTime,
  buildGraph,
  eventDemandVph,
  gunturEventSegments,
  nearestNode,
  parseCsv,
  parseWkt,
  shortestRoadPath,
} from "@/lib/guntur-graph"

// Four nodes ~110 m apart near Guntur. A->B->C is a fast path, A->C direct is slow.
// D<->C is a two-way residential street.
const nodes = [
  { node_id: "A", latitude: "16.3000", longitude: "80.4000", street_count: "2" },
  { node_id: "B", latitude: "16.3010", longitude: "80.4000", street_count: "2" },
  { node_id: "C", latitude: "16.3020", longitude: "80.4000", street_count: "3" },
  { node_id: "D", latitude: "16.3020", longitude: "80.4010", street_count: "1" },
]
function road(id: string, from: string, to: string, t0: number, cap: number, type = "residential") {
  const a = nodes.find((n) => n.node_id === from)!
  const b = nodes.find((n) => n.node_id === to)!
  return {
    road_id: id,
    from_node: from,
    to_node: to,
    length_m: "110",
    road_type: type,
    free_flow_time_sec: String(t0),
    capacity_vph: String(cap),
    geometry_wkt: `LINESTRING (${a.longitude} ${a.latitude}, ${b.longitude} ${b.latitude})`,
  }
}
const roads = [
  road("AB", "A", "B", 10, 700),
  road("BC", "B", "C", 10, 700),
  road("AC", "A", "C", 100, 700),
  road("CD", "C", "D", 10, 700),
  road("DC", "D", "C", 10, 700),
]
const zones = [{ zone_id: "south", nearest_node_id: "A", vehicle_share: "0.5" }]

describe("csv + wkt", () => {
  it("keeps commas inside quoted fields", () => {
    const rows = parseCsv('id,wkt,name\n1,"LINESTRING (1 2, 3 4)",x\n')
    expect(rows[0].wkt).toBe("LINESTRING (1 2, 3 4)")
    expect(rows[0].name).toBe("x")
  })
  it("returns [lat, lng] from a lng-lat WKT", () => {
    expect(parseWkt("LINESTRING (80.4 16.3, 80.5 16.4)")).toEqual([
      [16.3, 80.4],
      [16.4, 80.5],
    ])
  })
})

describe("routing", () => {
  const g = buildGraph(roads, nodes, zones)
  it("takes the fast path", () => {
    expect(shortestRoadPath(g, "A", "C").map((i) => g.roads[i].id)).toEqual(["AB", "BC"])
  })
  it("respects one-way direction", () => {
    expect(shortestRoadPath(g, "C", "A")).toEqual([])
  })
  it("finds the nearest node", () => {
    const n = nearestNode(g, 16.3011, 80.4)!
    expect(n.id).toBe("B")
    expect(n.distM).toBeLessThan(20)
  })
})

describe("traffic model", () => {
  it("BPR: free flow at zero volume, +15% at capacity, capped at v/c = 4", () => {
    expect(bprTime(10, 0, 700)).toBe(10)
    expect(bprTime(10, 700, 700)).toBeCloseTo(11.5, 6)
    expect(bprTime(10, 1e9, 700)).toBeCloseTo(10 * (1 + BPR.alpha * BPR.vcCap ** BPR.beta), 6)
  })
  it("evening peak is busier than 3am and arterials are busier than residential", () => {
    expect(baselineProfile(18, false, "residential")).toBeGreaterThan(baselineProfile(3, false, "residential"))
    expect(baselineProfile(18, false, "primary")).toBeGreaterThan(baselineProfile(18, false, "residential"))
  })
  it("routes zone demand onto the path only, conserving vehicles", () => {
    const g = buildGraph(roads, nodes, zones)
    const d = eventDemandVph(g, "C", 10000)
    const expected = 10000 * VEHICLES_PER_ATTENDEE * PEAK_HOUR_SHARE * 0.5
    const idx = (id: string) => g.roads.findIndex((r) => r.id === id)
    expect(d[idx("AB")]).toBeCloseTo(expected, 6)
    expect(d[idx("BC")]).toBeCloseTo(expected, 6)
    expect(d[idx("AC")]).toBe(0)
    expect(d[idx("CD")]).toBe(0)
  })
})

describe("gunturEventSegments", () => {
  const g = buildGraph(roads, nodes, zones)
  const base = { lat: 16.302, lng: 80.4, attendance: 10000, hour: 18, weekend: false, radiusM: 1000 }

  it("returns null when the venue is outside the graph", () => {
    expect(gunturEventSegments({ ...base, lat: 17.385, lng: 78.4867, phase: 1 }, g)).toBeNull()
  })
  it("returns null when no dataset is loaded", () => {
    expect(gunturEventSegments({ ...base, phase: 1 }, null)).toBeNull()
  })
  it("an event adds delay on the approach roads only while it is active", () => {
    const active = gunturEventSegments({ ...base, phase: 1 }, g)!
    const idle = gunturEventSegments({ ...base, phase: 0 }, g)!
    expect(active.segments.reduce((s, x) => s + x.delaySec, 0)).toBeGreaterThan(0)
    expect(idle.segments.every((s) => s.delaySec === 0)).toBe(true)
  })
  it("merges a two-way street into one segment and keeps the busier direction", () => {
    const r = gunturEventSegments({ ...base, phase: 1 }, g)!
    // AB, BC, AC, and the CD/DC pair -> 4 drawn segments
    expect(r.segments).toHaveLength(4)
  })
  it("baseline congestion is the no-event level: within 0..1, never above event congestion, equal when idle", () => {
    const active = gunturEventSegments({ ...base, phase: 1 }, g)!
    const idle = gunturEventSegments({ ...base, phase: 0 }, g)!
    expect(active.segments.every((x) => x.baseCongestion >= 0 && x.baseCongestion <= 1 && x.baseCongestion <= x.congestion + 1e-9)).toBe(true)
    expect(idle.segments.every((x) => Math.abs(x.baseCongestion - x.congestion) < 1e-9)).toBe(true)
  })
  it("congestion stays within 0..1", () => {
    const r = gunturEventSegments({ ...base, phase: 1 }, g)!
    expect(r.segments.every((s) => s.congestion >= 0 && s.congestion <= 1)).toBe(true)
    expect(r.segments.some((s) => s.vcr > 1)).toBe(true) // 3.3k veh/h on a 700 veh/h street
  })
})

describe("compareRoutesUnderEvent", () => {
  // A -> B -> C (fast, but B is the venue) vs A -> D -> C (slower bypass).
  const n = [
    { node_id: "A", latitude: "16.3000", longitude: "80.4000" },
    { node_id: "B", latitude: "16.3010", longitude: "80.4000" },
    { node_id: "C", latitude: "16.3020", longitude: "80.4000" },
    { node_id: "D", latitude: "16.3010", longitude: "80.4010" },
  ]
  const r = (id: string, from: string, to: string, t0: number) => {
    const a = n.find((x) => x.node_id === from)!
    const b = n.find((x) => x.node_id === to)!
    return {
      road_id: id, road_name: id, from_node: from, to_node: to, length_m: "110", road_type: "residential",
      free_flow_time_sec: String(t0), capacity_vph: "700",
      geometry_wkt: `LINESTRING (${a.longitude} ${a.latitude}, ${b.longitude} ${b.latitude})`,
    }
  }
  const g = buildGraph([r("AB", "A", "B", 20), r("BC", "B", "C", 20), r("AD", "A", "D", 25), r("DC", "D", "C", 25)], n, [
    { zone_id: "south", nearest_node_id: "A", vehicle_share: "1" },
  ])
  const args = {
    from: { lat: 16.3, lon: 80.4 },
    to: { lat: 16.302, lon: 80.4 },
    venue: { lat: 16.301, lng: 80.4, attendance: 10000 },
    hour: 3, // quiet baseline so the event is the only big load
    weekend: false,
  }

  it("re-routes around the loaded road and saves time, timed with the same model", async () => {
    const { compareRoutesUnderEvent } = await import("@/lib/guntur-graph")
    const out = compareRoutesUnderEvent({ ...args, phase: 1 }, g)!
    expect(out.normal.roadNames).toEqual(["AB", "BC"])
    expect(out.rerouted.roadNames).toEqual(["AD", "DC"])
    expect(out.samePath).toBe(false)
    expect(out.savedSec).toBeGreaterThan(0)
    expect(out.rerouted.underEventSec).toBeLessThan(out.normal.underEventSec)
    expect(out.normal.freeFlowSec).toBe(40)
  })

  it("keeps the normal route when the event is not running", async () => {
    const { compareRoutesUnderEvent } = await import("@/lib/guntur-graph")
    const out = compareRoutesUnderEvent({ ...args, phase: 0 }, g)!
    expect(out.samePath).toBe(true)
    expect(out.savedSec).toBe(0)
  })

  it("returns null when the trip is outside the graph", async () => {
    const { compareRoutesUnderEvent } = await import("@/lib/guntur-graph")
    expect(compareRoutesUnderEvent({ ...args, from: { lat: 17.4, lon: 78.5 }, phase: 1 }, g)).toBeNull()
  })
})
