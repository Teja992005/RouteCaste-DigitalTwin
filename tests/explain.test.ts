import { describe, expect, it } from "vitest"
import { explainEtaDelay } from "@/lib/explain"
import type { EtaModelInput } from "@/lib/ml-contracts"

const base: EtaModelInput = { distanceKm: 5, currentTravelTimeSec: 600, congestionProxy: 0.2, eventProximity: 0, scenarioSeverity: 0, eventLoad: 0 }
const event: EtaModelInput = { ...base, currentTravelTimeSec: 900, congestionProxy: 0.5, eventProximity: 0.8, scenarioSeverity: 0.6, eventLoad: 0.5 }

describe("explainEtaDelay", () => {
  it("shares add up exactly to the model's event minus baseline ETA (with interactions)", async () => {
    // non-additive model: proximity only matters when load is on
    const f = async (i: EtaModelInput) => i.currentTravelTimeSec / 60 + 10 * i.eventProximity * i.eventLoad + 2 * i.scenarioSeverity
    const r = await explainEtaDelay(base, event, f)
    const total = (await f(event)) - (await f(base))
    expect(r.totalMin).toBeCloseTo(total, 9)
    expect(r.drivers.reduce((s, d) => s + d.minutes, 0)).toBeCloseTo(total, 9)
    expect(r.drivers.reduce((s, d) => s + d.share, 0)).toBeCloseTo(1, 9)
  })
  it("attributes everything to the one input the model uses", async () => {
    const r = await explainEtaDelay(base, event, async (i) => 20 * i.eventLoad)
    expect(r.drivers[0].id).toBe("load")
    expect(r.drivers[0].minutes).toBeCloseTo(10, 9)
    for (const d of r.drivers.slice(1)) expect(d.minutes).toBeCloseTo(0, 9)
  })
  it("gives zero shares when there is no delay", async () => {
    const r = await explainEtaDelay(base, base, async () => 12)
    expect(r.totalMin).toBe(0)
    expect(r.drivers.every((d) => d.share === 0 && d.minutes === 0)).toBe(true)
  })
})
