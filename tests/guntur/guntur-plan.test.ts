import { describe, expect, it } from "vitest"
import { buildGraph } from "@/lib/guntur-graph"
import { buildOrganizerPlan, pickWaves, type WaveOption } from "@/lib/guntur-plan"

const nodes = [
  { node_id: "A", latitude: "16.3000", longitude: "80.4000" },
  { node_id: "B", latitude: "16.3010", longitude: "80.4000" },
  { node_id: "C", latitude: "16.3020", longitude: "80.4000" },
  { node_id: "D", latitude: "16.3005", longitude: "80.4010" },
]
const road = (id: string, from: string, to: string, name: string, t0: number, cap: number, type: string) => {
  const a = nodes.find((n) => n.node_id === from)!
  const b = nodes.find((n) => n.node_id === to)!
  return {
    road_id: id, road_name: name, from_node: from, to_node: to, length_m: "110", road_type: type,
    free_flow_time_sec: String(t0), capacity_vph: String(cap),
    geometry_wkt: `LINESTRING (${a.longitude} ${a.latitude}, ${b.longitude} ${b.latitude})`,
  }
}
// Zone roads A->B and C->B are small streets; A->D->B is a high-capacity bypass.
const roads = [
  road("AB", "A", "B", "Small Street", 20, 700, "residential"),
  road("CB", "C", "B", "Other Street", 20, 700, "residential"),
  road("AD", "A", "D", "Bypass West", 25, 3000, "primary"),
  road("DB", "D", "B", "Bypass East", 25, 3000, "primary"),
]
const zones = [
  { zone_id: "z1", zone_name: "Zone One", nearest_node_id: "A", vehicle_share: "0.4" },
  { zone_id: "z2", zone_name: "Zone Two", nearest_node_id: "C", vehicle_share: "0.4" },
  { zone_id: "z3", zone_name: "Zone Three", nearest_node_id: "A", vehicle_share: "0.2" },
]
const g = buildGraph(roads, nodes, zones)
const input = { venue: { lat: 16.301, lng: 80.4, attendance: 10000 }, startTime: "2026-09-11T18:00:00" }

function opt(waves: number, delay: number): WaveOption {
  return { waves, peakHourShare: 1 / waves, peakHourVehicles: 0, overCapacityRoads: 0, delayVehicleHours: delay, worstRoadDelaySec: 0 }
}

describe("pickWaves", () => {
  it("returns one wave when staggering cannot help", () => {
    expect(pickWaves([opt(1, 0), opt(2, 0), opt(3, 0), opt(4, 0)]).waves).toBe(1)
  })
  it("does not recommend staggering for a trivial saving", () => {
    expect(pickWaves([opt(1, 0.4), opt(2, 0.2), opt(3, 0.1), opt(4, 0.05)]).waves).toBe(1)
  })
  it("recommends staggering if it clears an overloaded road even when the saving is small", () => {
    const withRoads = [opt(1, 0.4), opt(2, 0.2), opt(3, 0.1), opt(4, 0.05)].map((o, i) => ({ ...o, overCapacityRoads: i < 2 ? 2 : 0 }))
    expect(pickWaves(withRoads).waves).toBe(3)
  })
  it("picks the smallest split with at least 80% of the achievable reduction", () => {
    // best = 100 -> 10 (reduction 90); 2 waves gets 50 (55%), 3 waves gets 85 (94%)
    expect(pickWaves([opt(1, 100), opt(2, 50), opt(3, 15), opt(4, 10)]).waves).toBe(3)
  })
  it("does not over-split when two waves already capture most of it", () => {
    expect(pickWaves([opt(1, 100), opt(2, 12), opt(3, 10), opt(4, 10)]).waves).toBe(2)
  })
})

describe("buildOrganizerPlan", () => {
  it("returns null outside the graph, without a graph, or with a bad start time", () => {
    expect(buildOrganizerPlan({ ...input, venue: { lat: 17.4, lng: 78.5, attendance: 5000 } }, g)).toBeNull()
    expect(buildOrganizerPlan(input, null)).toBeNull()
    expect(buildOrganizerPlan({ ...input, startTime: "not a date" }, g)).toBeNull()
  })

  it("evaluates the busiest arrival hour, one hour before the start", () => {
    expect(buildOrganizerPlan(input, g)!.evaluatedHour).toBe(17)
  })

  it("more waves never add delay, and unmanaged carries 2/3 of vehicles in the peak hour", () => {
    const plan = buildOrganizerPlan(input, g)!
    expect(plan.options.map((o) => o.waves)).toEqual([1, 2, 3, 4])
    expect(plan.options[0].peakHourShare).toBeCloseTo(2 / 3, 9)
    for (let i = 1; i < plan.options.length; i++) {
      expect(plan.options[i].delayVehicleHours).toBeLessThanOrEqual(plan.options[i - 1].delayVehicleHours)
    }
  })

  it("the plan is never worse than doing nothing, and diversions never make waves-only worse", () => {
    const plan = buildOrganizerPlan(input, g)!
    expect(plan.after.delayVehicleHours).toBeLessThanOrEqual(plan.wavesOnly.delayVehicleHours)
    expect(plan.wavesOnly.delayVehicleHours).toBeLessThan(plan.before.delayVehicleHours)
    expect(plan.after.overCapacityRoads).toBeLessThanOrEqual(plan.before.overCapacityRoads)
  })

  it("suggests the high-capacity bypass for the zone whose small street is overloaded", () => {
    const plan = buildOrganizerPlan({ ...input, venue: { ...input.venue, attendance: 30000 } }, g)!
    const d = plan.diversions.find((x) => x.zoneId === "z1")
    expect(d).toBeDefined()
    expect(d!.normalRoads).toContain("Small Street")
    expect(d!.divertedRoads).toEqual(["Bypass West", "Bypass East"])
    expect(d!.savedSec).toBeGreaterThan(30)
    expect(d!.latLngs.length).toBeGreaterThan(1)
  })

  it("suggests no diversion when nothing is overloaded", () => {
    const plan = buildOrganizerPlan({ ...input, venue: { ...input.venue, attendance: 100 } }, g)!
    expect(plan.diversions).toEqual([])
    expect(plan.recommendedWaves).toBe(1)
  })

  it("merges marshalling points that fall on the same node and sums their traffic", () => {
    const plan = buildOrganizerPlan(input, g)!
    // z1 and z3 both start at A, so they share one point; z2 starts at C.
    expect(plan.marshalPoints).toHaveLength(2)
    const shared = plan.marshalPoints.find((m) => m.zoneName.includes("+"))!
    expect(shared.zoneName).toBe("Zone One + Zone Three")
    const total = plan.marshalPoints.reduce((s, m) => s + m.vehiclesPerHour, 0)
    expect(total).toBeCloseTo(Math.round(10000 * 0.4983 * (2 / 3) * 0.4) * 2 + Math.round(10000 * 0.4983 * (2 / 3) * 0.2), -1)
  })

  it("states its assumptions", () => {
    const plan = buildOrganizerPlan(input, g)!
    expect(plan.assumptions.some((a) => /not measured/i.test(a))).toBe(true)
  })
})
