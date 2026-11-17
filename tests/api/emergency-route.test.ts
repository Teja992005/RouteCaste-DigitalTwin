import { afterEach, describe, expect, it, vi } from "vitest"
import { POST } from "@/app/api/emergency/route"

function encodeValue(v: number) {
  let n = Math.round(v * 1e5)
  n = n < 0 ? ~(n << 1) : n << 1
  let out = ""
  while (n >= 0x20) {
    out += String.fromCharCode((0x20 | (n & 0x1f)) + 63)
    n >>= 5
  }
  return out + String.fromCharCode(n + 63)
}
const polyline = (pts: [number, number][]) => {
  let la = 0, ln = 0, out = ""
  for (const [a, b] of pts) {
    out += encodeValue(a - la) + encodeValue(b - ln)
    la = a
    ln = b
  }
  return out
}
const osrm = (durationSec: number) => ({
  ok: true,
  json: async () => ({
    code: "Ok",
    routes: [{ distance: 3000, duration: durationSec, geometry: polyline([[16.3, 80.4], [16.31, 80.41]]), legs: [{ summary: "Main Rd" }] }],
  }),
})
const call = (extra: Record<string, unknown>) =>
  POST(new Request("http://x/api/emergency", {
    method: "POST",
    body: JSON.stringify({ originLat: 16.3, originLng: 80.4, destLat: 16.31, destLng: 80.41, hourOverride: 18, ...extra }),
  }))

afterEach(() => vi.unstubAllGlobals())

describe("POST /api/emergency", () => {
  it("measures event delay against normal traffic, not free-flow", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => osrm(360)))
    const none = await (await call({})).json()
    expect(none.normalEtaMin).toBeCloseTo(6 * 1.4, 6) // 18:00 rush-hour multiplier
    expect(none.delayMin).toBeCloseTo(0, 9)
    expect(none.severity).toBe("minimal")
  })
  it("a tiny event nearby is minimal even though rush hour is slower than free-flow", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => osrm(360)))
    const r = await (await call({ eventLat: 16.305, eventLng: 80.405, eventLoad: 0.02 })).json()
    expect(r.normalEtaMin).toBeGreaterThan(r.baseEtaMin)
    expect(r.delayMin).toBeCloseTo(r.eventEtaMin - r.normalEtaMin, 9)
    expect(r.severity).toBe("minimal")
  })
  it("a maximal event on the route is critical", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => osrm(360)))
    const r = await (await call({ eventLat: 16.305, eventLng: 80.405, eventLoad: 1 })).json()
    expect(r.degradationPct).toBeGreaterThanOrEqual(50)
    expect(r.severity).toBe("critical")
  })
  it("rejects invalid input", async () => {
    expect((await call({ originLat: "x" })).status).toBe(400)
  })
  it("reports failure (never HTML) when the routing service is down and no local route exists", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline") }))
    const res = await call({ originLat: 17.4, originLng: 78.4, destLat: 17.5, destLng: 78.5 })
    expect(res.status).toBe(500)
    expect((await res.json()).latLngs).toEqual([])
  })
})
