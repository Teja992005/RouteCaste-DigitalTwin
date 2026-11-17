/**
 * One-click demo scenarios for the judges' demo. Each fixes a Guntur trip and
 * one or more events at known landmarks, with fixed local clock times so the
 * result does not depend on what time the demo is run.
 */
export type DemoEvent = {
  placeId: string
  name: string
  type: "festival" | "sports" | "concert" | "protest" | "other"
  attendance: number
  startHour: number
  endHour: number
  radiusMeters: number
}

export type DemoPreset = {
  id: string
  label: string
  /** What this scenario is meant to show, in one line. */
  shows: string
  fromPlaceId: string
  toPlaceId: string
  events: DemoEvent[]
}

export const DEMO_PRESETS: DemoPreset[] = [
  {
    id: "big-concert",
    label: "Big evening concert",
    shows: "Heavy delay on the trip; before/after heatmap, why-is-it-slow panel and the organizer plan",
    fromPlaceId: "guntur-jn",
    toPlaceId: "loyola-college",
    events: [{ placeId: "bus-stand", name: "Evening Concert", type: "concert", attendance: 10000, startHour: 18, endHour: 21, radiusMeters: 800 }],
  },
  {
    id: "small-gathering",
    label: "Small gathering",
    shows: "A small event causes a much smaller delay than the big concert: the model scales with crowd size",
    fromPlaceId: "guntur-jn",
    toPlaceId: "loyola-college",
    events: [{ placeId: "bus-stand", name: "Community Gathering", type: "other", attendance: 500, startHour: 18, endHour: 20, radiusMeters: 400 }],
  },
  {
    id: "two-events",
    label: "Two events at once",
    shows: "A concert near the start and a college fest at the destination: events combine on the same trip (an extrapolation beyond single-event training)",
    fromPlaceId: "guntur-jn",
    toPlaceId: "loyola-college",
    events: [
      { placeId: "bus-stand", name: "Evening Concert", type: "concert", attendance: 8000, startHour: 18, endHour: 21, radiusMeters: 800 },
      { placeId: "loyola-college", name: "College Fest", type: "festival", attendance: 6000, startHour: 17, endHour: 20, radiusMeters: 700 },
    ],
  },
]

/** ISO time for a local clock hour today. */
export function localHourIso(hour: number, base: Date = new Date()): string {
  const d = new Date(base)
  d.setHours(Math.floor(hour), Math.round((hour % 1) * 60), 0, 0)
  return d.toISOString()
}
