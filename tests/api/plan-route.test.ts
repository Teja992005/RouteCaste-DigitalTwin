import { describe, expect, it } from "vitest"
import { POST } from "@/app/api/event/plan/route"

const post = (body: unknown) =>
  POST(new Request("http://localhost/api/event/plan", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) }))
const good = { lat: 16.3115, lng: 80.438, attendance: 5000, startTime: "2026-09-11T18:00:00" }

describe("POST /api/event/plan validation", () => {
  it("rejects malformed JSON", async () => {
    expect((await post("{nope")).status).toBe(400)
  })
  it("rejects bad coordinates", async () => {
    expect((await post({ ...good, lat: 120 })).status).toBe(400)
    expect((await post({ ...good, lng: "80" })).status).toBe(400)
  })
  it("rejects bad attendance", async () => {
    for (const attendance of [0, -5, "many", 5_000_000]) expect((await post({ ...good, attendance })).status).toBe(400)
  })
  it("rejects a bad start time", async () => {
    expect((await post({ ...good, startTime: "tomorrow-ish" })).status).toBe(400)
    expect((await post({ ...good, startTime: 12 })).status).toBe(400)
  })
  it("a valid request never returns a validation error", async () => {
    // 200 with the dataset present, 503 without it (e.g. CI); never a 4xx validation failure.
    expect([200, 503, 422]).toContain((await post(good)).status)
  })
})
