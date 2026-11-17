import { describe, expect, it } from "vitest"
import { planToHtml, waveSlots } from "@/lib/plan-export"
import type { OrganizerPlan } from "@/lib/guntur-plan"

const m = { overCapacityRoads: 10, delayVehicleHours: 5.5, worstRoadDelaySec: 30 }
const plan = {
  evaluatedHour: 17, weekend: false, radiusM: 2500, options: [], recommendedWaves: 3, waveReason: "3 waves is best.",
  diversions: [{ zoneId: "e", zoneName: "East <Guntur>", normalRoads: ["A"], divertedRoads: ["B", "C"], savedSec: 90, normalMin: 20, divertedMin: 18, latLngs: [] }],
  marshalPoints: [{ zoneId: "n", zoneName: "North", lat: 16.3, lng: 80.4, roadName: "Main Rd", vehiclesPerHour: 700 }],
  before: { ...m, overCapacityRoads: 100 }, wavesOnly: m, after: m, assumptions: ["Modeled, not measured."],
} as unknown as OrganizerPlan

describe("plan export", () => {
  it("lists one slot per wave ending at the start", () => {
    expect(waveSlots(new Date("2026-09-11T18:00:00"), 3)).toHaveLength(3)
  })
  it("renders the plan and escapes event and road names", () => {
    const html = planToHtml(plan, { name: "A & <b>B</b>", attendance: 10000, startTime: "2026-09-11T18:00:00" })
    expect(html).toContain("A &amp; &lt;b&gt;B&lt;/b&gt;")
    expect(html).toContain("East &lt;Guntur&gt;")
    expect(html).toContain("3 waves")
    expect(html).toContain("Main Rd")
    expect(html).not.toContain("<b>B</b>")
  })
  it("says so when no staggering or diversion is needed", () => {
    const html = planToHtml({ ...plan, recommendedWaves: 1, diversions: [] }, { name: "E", attendance: 100, startTime: "2026-09-11T18:00:00" })
    expect(html).toContain("No staggering needed.")
    expect(html).toContain("No diversion beats")
  })
})
