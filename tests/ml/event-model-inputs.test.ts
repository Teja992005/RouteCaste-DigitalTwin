// ---------------------------------------------------------------------------
// Unit tests for lib/event-model-inputs.ts.
//
// Expected load / proximity / severity values were produced by running the
// real Python training functions (ml/data.py: calculate_event_load,
// calculate_event_proximity, calculate_scenario_severity), so these tests pin
// the TypeScript inputs to what the models were actually trained on.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest"
import {
  DOW_MULTIPLIER,
  EVENT_CONGESTION_BOOST,
  attendanceBoostScale,
  TYPICAL_ROAD_CAPACITY_PROXY,
  baselineCongestion,
  buildEventScenarioInputs,
  buildMultiEventScenarioInputs,
  eventIntensityAtTime,
  MAX_EVENTS,
  congestionFeature,
  eventIntensityAtHour,
  eventProximityFeatures,
  MIN_EVENT_INTENSITY,
  speedRatio,
  trainedEventLoad,
  trainingDayOfWeek,
} from "@/lib/event-model-inputs"

describe("trainedEventLoad (matches ml/data.py calculate_event_load)", () => {
  const cases: [number, number, number][] = [
    [500, 240, 0.189604],
    [5000, 240, 0.546042],
    [45000, 240, 0.914375],
    [100, 60, 0.059483],
    [80000, 480, 0.908333],
  ]
  for (const [attendance, durationMin, expected] of cases) {
    it(`${attendance} attendees, ${durationMin} min -> ${expected}`, () => {
      expect(trainedEventLoad(attendance, durationMin)).toBeCloseTo(expected, 5)
    })
  }

  it("grows with attendance", () => {
    expect(trainedEventLoad(45000, 240)).toBeGreaterThan(trainedEventLoad(5000, 240))
    expect(trainedEventLoad(5000, 240)).toBeGreaterThan(trainedEventLoad(500, 240))
  })
})

describe("eventProximityFeatures (matches calculate_event_proximity / severity)", () => {
  const cases: [number, number, number, number][] = [
    // distance, radius, proximity, severity (= distance weight)
    [0, 610, 1.0, 1.0],
    [300, 610, 0.75, 0.508197],
    [700, 610, 0.5, 0.0],
    [1200, 1430, 0.160839, 0.160839],
    [2000, 610, 0.0, 0.0],
  ]
  for (const [distance, radius, proximity, severity] of cases) {
    it(`${distance} m from the venue, radius ${radius} m`, () => {
      const r = eventProximityFeatures(distance, radius)
      expect(r.proximity).toBeCloseTo(proximity, 5)
      expect(r.distanceWeight).toBeCloseTo(severity, 5)
    })
  }

  it("treats an unknown or infinite distance as no proximity", () => {
    expect(eventProximityFeatures(Number.POSITIVE_INFINITY, 610)).toEqual({ proximity: 0, distanceWeight: 0 })
    expect(eventProximityFeatures(Number.NaN, 610)).toEqual({ proximity: 0, distanceWeight: 0 })
  })
})

describe("congestion feature transform", () => {
  it("current_congestion feature is 0.85·c², not c", () => {
    expect(congestionFeature(0.8)).toBeCloseTo(0.85 * 0.64, 6)
    expect(congestionFeature(0.5)).toBeCloseTo(0.2125, 6)
    expect(congestionFeature(0)).toBe(0)
  })

  it("speed ratio is floored at 0.05", () => {
    expect(speedRatio(0.98)).toBeGreaterThanOrEqual(0.05)
    expect(speedRatio(1)).toBeCloseTo(0.15, 6)
  })
})

describe("baselineCongestion (matches the dataset generator tables)", () => {
  it("returns the hourly value times the day multiplier", () => {
    expect(baselineCongestion(18, 0)).toBeCloseTo(0.85, 6) // Monday 18:00
    expect(baselineCongestion(3, 0)).toBeCloseTo(0.05, 6) // Monday 03:00
  })

  it("interpolates linearly between hours", () => {
    expect(baselineCongestion(8.5, 0)).toBeCloseTo((0.78 + 0.82) / 2, 6)
  })

  it("wraps from 23:xx to 00:00", () => {
    expect(baselineCongestion(23.5, 0)).toBeCloseTo((0.12 + 0.08) / 2, 6)
  })

  it("applies the Friday and Sunday multipliers, clamped to 1", () => {
    expect(baselineCongestion(12, 4)).toBeCloseTo(0.44 * DOW_MULTIPLIER[4], 6)
    expect(baselineCongestion(12, 6)).toBeCloseTo(0.44 * DOW_MULTIPLIER[6], 6)
    expect(baselineCongestion(18, 4)).toBe(1) // 0.85 × 1.18 > 1
  })
})

describe("trainingDayOfWeek", () => {
  it("maps JS Sunday-first to the training Monday-first index", () => {
    expect(trainingDayOfWeek(new Date(2026, 10, 15))).toBe(6) // Sunday
    expect(trainingDayOfWeek(new Date(2026, 10, 16))).toBe(0) // Monday
    expect(trainingDayOfWeek(new Date(2026, 10, 20))).toBe(4) // Friday
  })
})

describe("buildEventScenarioInputs", () => {
  const base = {
    distanceMeters: 5000,
    freeFlowSec: 600,
    hour: 19,
    dayOfWeek: 4,
    eventType: "festival" as const,
    attendance: 5000,
    durationMin: 240,
    impactRadiusM: 610,
  }

  it("baseline carries no event features", () => {
    const s = buildEventScenarioInputs({ ...base, minDistanceToEventM: 0 })
    expect(s.baseline.eta.eventProximity).toBe(0)
    expect(s.baseline.eta.scenarioSeverity).toBe(0)
    expect(s.baseline.eta.eventLoad).toBe(0)
    expect(s.baseline.congestionInput.incidentLoad).toBe(0)
  })

  it("a route through the venue gets full proximity and the type boost", () => {
    const s = buildEventScenarioInputs({ ...base, minDistanceToEventM: 0, hour: 15, dayOfWeek: 0 })
    expect(s.proximity).toBe(1)
    expect(s.distanceWeight).toBe(1)
    const c0 = baselineCongestion(15, 0)
    expect(s.event.congestion).toBeCloseTo(Math.min(0.98, c0 + EVENT_CONGESTION_BOOST.festival * attendanceBoostScale("festival", base.attendance)), 6)
    expect(s.event.eta.eventLoad).toBeCloseTo(0.546042, 5)
  })

  it("a far route is not slowed and has zero proximity", () => {
    const s = buildEventScenarioInputs({ ...base, minDistanceToEventM: 5000 })
    expect(s.proximity).toBe(0)
    expect(s.event.congestion).toBeCloseTo(s.baseline.congestion, 9)
  })

  it("current travel time is the congested time and respects the training clamp", () => {
    const s = buildEventScenarioInputs({ ...base, minDistanceToEventM: 0 })
    expect(s.baseline.currentTravelTimeSec).toBeCloseTo(600 / speedRatio(s.baseline.congestion), 6)
    expect(s.event.currentTravelTimeSec).toBeGreaterThanOrEqual(s.baseline.currentTravelTimeSec)
    const long = buildEventScenarioInputs({ ...base, freeFlowSec: 9000, minDistanceToEventM: 0 })
    expect(long.event.currentTravelTimeSec).toBeLessThanOrEqual(3600)
  })

  it("uses the training-mean capacity proxy and the 15-minute horizon", () => {
    const s = buildEventScenarioInputs({ ...base, minDistanceToEventM: 0 })
    expect(s.event.congestionInput.roadCapacityProxy).toBe(TYPICAL_ROAD_CAPACITY_PROXY)
    expect(s.event.congestionInput.horizonMinutes).toBe(15)
  })

  it("larger attendance widens the zone of influence via the radius", () => {
    const small = buildEventScenarioInputs({ ...base, attendance: 500, impactRadiusM: 330, minDistanceToEventM: 1200 })
    const large = buildEventScenarioInputs({ ...base, attendance: 45000, impactRadiusM: 1430, minDistanceToEventM: 1200 })
    expect(small.distanceWeight).toBe(0)
    expect(large.distanceWeight).toBeGreaterThan(0)
  })
})

describe("eventIntensityAtHour", () => {
  const start = new Date(2026, 10, 20, 17, 0)
  const end = new Date(2026, 10, 20, 21, 0)

  it("is 1 at the event midpoint", () => {
    expect(eventIntensityAtHour(19, start, end).intensity).toBeCloseTo(1, 6)
  })
  it("is 0 before and after the event", () => {
    expect(eventIntensityAtHour(3, start, end).intensity).toBe(0)
    expect(eventIntensityAtHour(22, start, end).intensity).toBe(0)
  })
  it("rises toward the peak and is symmetric", () => {
    const a = eventIntensityAtHour(17.5, start, end).intensity
    const b = eventIntensityAtHour(18.5, start, end).intensity
    expect(b).toBeGreaterThan(a)
    expect(eventIntensityAtHour(18, start, end).intensity).toBeCloseTo(eventIntensityAtHour(20, start, end).intensity, 6)
  })
  it("handles events that cross midnight", () => {
    const s = new Date(2026, 10, 20, 22, 0)
    const e = new Date(2026, 10, 21, 2, 0)
    expect(eventIntensityAtHour(0, s, e).intensity).toBeCloseTo(1, 6)
    expect(eventIntensityAtHour(23, s, e).intensity).toBeGreaterThan(MIN_EVENT_INTENSITY)
    expect(eventIntensityAtHour(12, s, e).intensity).toBe(0)
  })
})

describe("buildEventScenarioInputs with event phase", () => {
  const args = {
    distanceMeters: 5000, freeFlowSec: 600, hour: 19, dayOfWeek: 4, eventType: "festival" as const,
    attendance: 5000, durationMin: 240, impactRadiusM: 610, minDistanceToEventM: 0,
  }
  it("equals the baseline when the event is not running", () => {
    const s = buildEventScenarioInputs({ ...args, eventIntensity: 0 })
    expect(s.eventActive).toBe(false)
    expect(s.event).toEqual(s.baseline)
    expect(s.proximity).toBe(0)
  })
  it("scales the congestion boost by phase", () => {
    const full = buildEventScenarioInputs({ ...args, hour: 12, dayOfWeek: 0, eventIntensity: 1 })
    const half = buildEventScenarioInputs({ ...args, hour: 12, dayOfWeek: 0, eventIntensity: 0.5 })
    expect(half.event.congestion).toBeLessThan(full.event.congestion)
    expect(half.event.congestion).toBeGreaterThan(half.baseline.congestion)
  })
})

describe("buildMultiEventScenarioInputs", () => {
  const route = { distanceMeters: 5000, freeFlowSec: 600, hour: 15, dayOfWeek: 0 }
  const festival = { eventType: "festival" as const, attendance: 5000, durationMin: 240, impactRadiusM: 610 }
  const sports = { eventType: "sports" as const, attendance: 20000, durationMin: 240, impactRadiusM: 1020 }

  it("with one event equals the single-event builder", () => {
    const single = buildEventScenarioInputs({ ...route, ...festival, minDistanceToEventM: 200 })
    const multi = buildMultiEventScenarioInputs({ ...route, events: [{ ...festival, minDistanceToEventM: 200 }] })
    expect(multi).toEqual(single)
  })

  it("adds the boosts of two events that both reach the route", () => {
    const both = buildMultiEventScenarioInputs({
      ...route,
      events: [{ ...festival, minDistanceToEventM: 0 }, { ...sports, minDistanceToEventM: 0 }],
    })
    const c0 = baselineCongestion(15, 0)
    expect(both.event.congestion).toBeCloseTo(Math.min(0.98, c0 + EVENT_CONGESTION_BOOST.festival * attendanceBoostScale("festival", festival.attendance) + EVENT_CONGESTION_BOOST.sports * attendanceBoostScale("sports", sports.attendance)), 6)
    expect(both.affectingEvents).toEqual([0, 1])
  })

  it("combines load as 1 - product over the events that reach the route", () => {
    const both = buildMultiEventScenarioInputs({
      ...route,
      events: [{ ...festival, minDistanceToEventM: 0 }, { ...sports, minDistanceToEventM: 0 }],
    })
    const expected = 1 - (1 - trainedEventLoad(5000, 240)) * (1 - trainedEventLoad(20000, 240))
    expect(both.modelEventLoad).toBeCloseTo(expected, 9)
    expect(both.modelEventLoad).toBeGreaterThan(trainedEventLoad(20000, 240))
  })

  it("ignores an event that does not reach the route", () => {
    const alone = buildEventScenarioInputs({ ...route, ...festival, minDistanceToEventM: 0 })
    const withFar = buildMultiEventScenarioInputs({
      ...route,
      events: [{ ...festival, minDistanceToEventM: 0 }, { ...sports, minDistanceToEventM: 9000 }],
    })
    expect(withFar.event).toEqual(alone.event)
    expect(withFar.affectingEvents).toEqual([0])
  })

  it("leaves a route no event reaches exactly at baseline", () => {
    const s = buildMultiEventScenarioInputs({
      ...route,
      events: [{ ...festival, minDistanceToEventM: 9000 }, { ...sports, minDistanceToEventM: 9000 }],
    })
    expect(s.event).toEqual(s.baseline)
    expect(s.affectingEvents).toEqual([])
  })

  it("skips events that are not running", () => {
    const s = buildMultiEventScenarioInputs({
      ...route,
      events: [{ ...festival, minDistanceToEventM: 0, eventIntensity: 0 }, { ...sports, minDistanceToEventM: 0, eventIntensity: 1 }],
    })
    const sportsOnly = buildEventScenarioInputs({ ...route, ...sports, minDistanceToEventM: 0 })
    expect(s.event).toEqual(sportsOnly.event)
    expect(s.affectingEvents).toEqual([1])
  })
})

describe("eventIntensityAtTime", () => {
  const start = new Date(2026, 10, 20, 17, 0)
  const end = new Date(2026, 10, 20, 21, 0)
  it("is 1 at the midpoint and 0 outside the window", () => {
    expect(eventIntensityAtTime(new Date(2026, 10, 20, 19, 0).getTime(), start, end)).toBeCloseTo(1, 9)
    expect(eventIntensityAtTime(new Date(2026, 10, 20, 16, 59).getTime(), start, end)).toBe(0)
    expect(eventIntensityAtTime(new Date(2026, 10, 20, 21, 1).getTime(), start, end)).toBe(0)
  })
  it("MAX_EVENTS is 3", () => expect(MAX_EVENTS).toBe(3))
})

describe("attendanceBoostScale", () => {
  it("is 1 at or above the typical size and floors at 0.25", () => {
    expect(attendanceBoostScale("concert", 10500)).toBeCloseTo(1, 9)
    expect(attendanceBoostScale("concert", 100000)).toBe(1)
    expect(attendanceBoostScale("concert", 0)).toBe(0.25)
  })
  it("grows with attendance, so a small event disturbs traffic less than a big one", () => {
    expect(attendanceBoostScale("other", 500)).toBeLessThan(attendanceBoostScale("other", 2550))
    expect(attendanceBoostScale("concert", 500)).toBeLessThan(attendanceBoostScale("concert", 10000))
  })
  it("does not scale types where attendance is not the driver", () => {
    expect(attendanceBoostScale("construction", 0)).toBe(1)
    expect(attendanceBoostScale("vip_visit", 50)).toBe(1)
  })
  it("a small event gives a smaller congestion rise than a large one of the same type", () => {
    const common = { distanceMeters: 3000, freeFlowSec: 400, hour: 15, dayOfWeek: 0, eventType: "concert" as const, durationMin: 180, minDistanceToEventM: 0, impactRadiusM: 800 }
    const small = buildEventScenarioInputs({ ...common, attendance: 300 })
    const big = buildEventScenarioInputs({ ...common, attendance: 10000 })
    expect(small.event.congestion).toBeLessThan(big.event.congestion)
  })
})
