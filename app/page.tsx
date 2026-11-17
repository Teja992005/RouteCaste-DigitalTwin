"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import dynamic from "next/dynamic"
import type { Basemap, MapLayers, FlyTarget, LatLng } from "@/components/city-map"
import { LayerControls } from "@/components/layer-controls"
import { LocationSearch, type Place } from "@/components/location-search"
import { Satellite, Moon, Layers } from "lucide-react"
import { GUNTUR_BOUNDS, GUNTUR_CENTER, GUNTUR_PLACES } from "@/lib/guntur-places"
import { NavigationPanel } from "@/components/navigation-panel"
import { useNavigationRoute, type NavPoint, type TravelMode } from "@/hooks/use-navigation-route"
import { useGeolocation } from "@/hooks/use-geolocation"
import { useNavSession } from "@/hooks/use-nav-session"
import { NavHud } from "@/components/nav-hud"
import { PoiPanel, type Poi } from "@/components/poi-panel"
import { useRouteIntel, type IntelScenarioType } from "@/hooks/use-route-intel"
import { RouteIntelPanel } from "@/components/route-intel-panel"
import { WhatIfPanel } from "@/components/whatif-panel"
import { EventSchedulerPanel } from "@/components/event-scheduler-panel"
import { DEMO_PRESETS, localHourIso, type DemoPreset } from "@/lib/demo-presets"
import { OrganizerPlanPanel, type PlanOverlay } from "@/components/organizer-plan-panel"
import type { EventSimulationResponse } from "@/lib/types"
import { MAX_EVENTS, eventIntensityAtHour } from "@/lib/event-model-inputs"
import { ImpactDashboard } from "@/components/impact-dashboard"
import { MetricsDashboard } from "@/components/metrics-dashboard"
import { computeRouteMetrics } from "@/lib/route-metrics"
import { TimeSlider } from "@/components/time-slider"
import { IsochronePanel } from "@/components/isochrone-panel"
import { EmergencyPanel } from "@/components/emergency-panel"

// Map must be client-only (Leaflet accesses window)
const CityMap = dynamic(() => import("@/components/city-map").then((m) => m.CityMap), {
  ssr: false,
  loading: () => <ViewLoading label="Loading map" />,
})

type EventPin = { lat: number; lng: number; name: string; radiusMeters: number }
type HeatmapSegment = { points: [number, number][]; congestion: number; highway: string; baseCongestion?: number; delaySec?: number }

export default function Page() {
  const [basemap, setBasemap] = useState<Basemap>("satellite")
  const [flyTo, setFlyTo] = useState<FlyTarget | null>(null)
  const [place, setPlace] = useState<Place | null>(null)
  const [tripStart, setTripStart] = useState<LatLng | null>(null)
  const [tripEnd, setTripEnd] = useState<LatLng | null>(null)
  const [navFrom, setNavFrom] = useState<NavPoint | null>(null)
  const [navTo, setNavTo] = useState<NavPoint | null>(null)
  const [travelMode, setTravelMode] = useState<TravelMode>("driving")
  const [activeNavId, setActiveNavId] = useState<string | null>(null)
  const [navStops, setNavStops] = useState<NavPoint[]>([])
  const [pois, setPois] = useState<Poi[]>([])
  const [layersOpen, setLayersOpen] = useState(false)
  const [intelScenario, setIntelScenario] = useState<{ type: IntelScenarioType; intensity: number }>({
    type: "none",
    intensity: 0.6,
  })
  const [layers, setLayers] = useState<MapLayers>({
    traffic: true,
    incidents: true,
    pollution: false,
    closures: true,
  })

  // Event pin — placed by the user clicking the map in "event" mode
  const [eventPin, setEventPin] = useState<EventPin | null>(null)
  const [outOfBoundsWarning, setOutOfBoundsWarning] = useState(false)
  const [osrmStatus, setOsrmStatus] = useState<"checking" | "ok" | "down">("checking")
  const [simulationResult, setSimulationResult] = useState<EventSimulationResponse | null>(null)
  // Every simulated event (up to MAX_EVENTS). `simulationResult` is the one last
  // simulated and drives the single-event panels; the route table, dashboard,
  // map zones and heatmap use all of them.
  const [events, setEvents] = useState<EventSimulationResponse[]>([])
  const [eventCapWarning, setEventCapWarning] = useState(false)
  const eventKey = (lat: number, lng: number) => `${lat.toFixed(5)},${lng.toFixed(5)}`
  const commitSimulation = useCallback((result: EventSimulationResponse | null) => {
    setSimulationResult(result)
    if (!result) return
    setEvents((prev) => {
      const key = `${result.event.lat.toFixed(5)},${result.event.lng.toFixed(5)}`
      const index = prev.findIndex((e) => `${e.event.lat.toFixed(5)},${e.event.lng.toFixed(5)}` === key)
      if (index >= 0) return prev.map((e, i) => (i === index ? result : e))
      return prev.length >= MAX_EVENTS ? prev : [...prev, result]
    })
  }, [])
  const removeEventAt = useCallback((lat: number, lng: number) => {
    const key = `${lat.toFixed(5)},${lng.toFixed(5)}`
    setEvents((prev) => prev.filter((e) => `${e.event.lat.toFixed(5)},${e.event.lng.toFixed(5)}` !== key))
    setSimulationResult((cur) => (cur && `${cur.event.lat.toFixed(5)},${cur.event.lng.toFixed(5)}` === key ? null : cur))
  }, [])
  const [pendingDemo, setPendingDemo] = useState<DemoPreset | null>(null)
  const [demoMenuOpen, setDemoMenuOpen] = useState(false)
  const demoSimulationInFlight = useRef(false)
  const [eventIncidentLocation, setEventIncidentLocation] = useState<{ lat: number; lon: number } | null>(null)
  const [eventDriven, setEventDriven] = useState(false)
  const eventDrivenRef = useRef(false)
  const [heatmapSegments, setHeatmapSegments] = useState<HeatmapSegment[]>([])
  const [heatMode, setHeatMode] = useState<"event" | "normal" | "change">("event")
  const [timeOverride, setTimeOverride] = useState<number | null>(null)
  const [debouncedHeatmapHour, setDebouncedHeatmapHour] = useState<number | null>(timeOverride)
  const [isochroneNormal, setIsochroneNormal] = useState<[number, number][]>([])
  const [isochroneAffected, setIsochroneAffected] = useState<[number, number][]>([])
  const [emergencyRoute, setEmergencyRoute] = useState<[number, number][]>([])
  const [planOverlay, setPlanOverlay] = useState<PlanOverlay | null>(null)
  const [closurePoints, setClosurePoints] = useState<[{ lat: number; lng: number }, { lat: number; lng: number }] | null>(null)
  const [awaitingClosurePoint, setAwaitingClosurePoint] = useState<0 | 1 | null>(null)
  // Controls what a map click does: route A/B picking, event placement, or scenario incident pin
  const [mapClickMode, setMapClickMode] = useState<"route" | "event" | "scenario">("route")
  const [scenarioPin, setScenarioPin] = useState<{ lat: number; lon: number } | null>(null)
  // Timestamp guard: prevent the button-activation click from immediately placing the pin
  const scenarioModeActivatedAt = useRef<number>(0)
  const booted = useRef(false)
  const [urlStateReady, setUrlStateReady] = useState(false)

  // Restore shareable route and event state before syncing it back to the URL.
  useEffect(() => {
    if (booted.current) return
    booted.current = true
    const params = new URLSearchParams(window.location.search)
    const fl = params.get("fl")
    const fo = params.get("fo")
    const fn = params.get("fn")
    const tl = params.get("tl")
    const to = params.get("to")
    const tn = params.get("tn")
    const el = params.get("el")
    const eo = params.get("eo")
    const en = params.get("en")
    const mode = params.get("mode")

    if (fl && fo && Number.isFinite(Number(fl)) && Number.isFinite(Number(fo))) {
      const from: NavPoint = { lat: Number(fl), lon: Number(fo), label: fn ?? undefined }
      setNavFrom(from)
      setTripStart({ lat: from.lat, lng: from.lon })
    }
    if (tl && to && Number.isFinite(Number(tl)) && Number.isFinite(Number(to))) {
      const destination: NavPoint = { lat: Number(tl), lon: Number(to), label: tn ?? undefined }
      setNavTo(destination)
      setTripEnd({ lat: destination.lat, lng: destination.lon })
    }
    if (el && eo && Number.isFinite(Number(el)) && Number.isFinite(Number(eo))) {
      setEventPin({ lat: Number(el), lng: Number(eo), name: en ?? "Event Location", radiusMeters: 500 })
    }
    if (mode === "driving" || mode === "walking" || mode === "cycling") setTravelMode(mode)
    setUrlStateReady(true)
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 6000)
    fetch("/api/navigation/route", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        origin: { lat: 16.3067, lon: 80.4365 },
        destination: { lat: 16.2960, lon: 80.4572 },
        mode: "driving",
        alternatives: false,
      }),
      signal: controller.signal,
    })
      .then((response) => setOsrmStatus(response.ok ? "ok" : "down"))
      .catch(() => setOsrmStatus("down"))
      .finally(() => clearTimeout(timer))
    return () => controller.abort()
  }, [])

  // Sync key state into URL so the demo survives a refresh.
  useEffect(() => {
    if (!urlStateReady) return
    const params = new URLSearchParams()
    if (navFrom) {
      params.set("fl", String(navFrom.lat))
      params.set("fo", String(navFrom.lon))
      if (navFrom.label) params.set("fn", navFrom.label)
    }
    if (navTo) {
      params.set("tl", String(navTo.lat))
      params.set("to", String(navTo.lon))
      if (navTo.label) params.set("tn", navTo.label)
    }
    if (eventPin) {
      params.set("el", String(eventPin.lat))
      params.set("eo", String(eventPin.lng))
      params.set("en", eventPin.name)
    }
    if (travelMode !== "driving") params.set("mode", travelMode)
    const query = params.toString()
    const newUrl = query ? `?${query}` : window.location.pathname
    window.history.replaceState(null, "", newUrl)
  }, [navFrom, navTo, eventPin, travelMode, urlStateReady])

  useEffect(() => {
    if (!simulationResult) {
      if (eventDrivenRef.current) {
        setIntelScenario((previous) => previous.type === "traffic" ? { type: "none", intensity: 0.6 } : previous)
      }
      eventDrivenRef.current = false
      setEventDriven(false)
      setEventIncidentLocation(null)
      return
    }

    const intensity = Math.min(1, simulationResult.event.eventLoad * 1.3)
    eventDrivenRef.current = true
    setEventDriven(true)
    setIntelScenario({ type: "traffic", intensity })
    setEventIncidentLocation({ lat: simulationResult.event.lat, lon: simulationResult.event.lng })
  }, [simulationResult])

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedHeatmapHour(timeOverride), 400)
    return () => clearTimeout(timer)
  }, [timeOverride])

  useEffect(() => {
    if (events.length === 0) {
      setHeatmapSegments([])
      return
    }

    const controller = new AbortController()
    async function loadHeatmap() {
      try {
        // One heat layer per event. At a slider hour each event only loads the
        // roads while it is running: scale its load by its phase (0 before and
        // after, 1 at its midpoint). The live view shows events at their peak.
        const layers = await Promise.all(
          events.map(async (current) => {
            const eventPhase =
              debouncedHeatmapHour === null
                ? 1
                : eventIntensityAtHour(debouncedHeatmapHour, new Date(current.event.startTime), new Date(current.event.endTime)).intensity
            const response = await fetch("/api/heatmap", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                lat: current.event.lat,
                lng: current.event.lng,
                impactRadiusMeters: current.event.impactRadiusMeters,
                eventLoad: current.event.eventLoad * eventPhase,
                attendance: current.event.attendance,
                eventPhase,
                ...(debouncedHeatmapHour === null ? {} : { hourOverride: debouncedHeatmapHour }),
              }),
              signal: controller.signal,
            })
            if (!response.ok) throw new Error("Heatmap request failed")
            const data = (await response.json()) as { segments?: HeatmapSegment[] }
            return Array.isArray(data.segments) ? data.segments : []
          }),
        )
        // Hottest segments last so they draw on top where events overlap.
        setHeatmapSegments(layers.flat().sort((a, b) => a.congestion - b.congestion))
      } catch {
        if (!controller.signal.aborted) setHeatmapSegments([])
      }
    }

    void loadHeatmap()
    return () => controller.abort()
  }, [events, debouncedHeatmapHour])

  const isSatellite = basemap !== "dark"

  function handlePlace(p: Place) {
    setPlace(p)
    setFlyTo({ lat: p.lat, lng: p.lng, zoom: p.kind === "country" ? 6 : p.kind === "state" ? 9 : 13, nonce: Date.now() })
  }

  // Keep the A/B map markers and the routing endpoints in sync.
  function pickFrom(p: NavPoint | null) {
    setNavFrom(p)
    setTripStart(p ? { lat: p.lat, lng: p.lon } : null)
    if (p) setFlyTo({ lat: p.lat, lng: p.lon, zoom: 13, nonce: Date.now() })
  }
  function pickTo(p: NavPoint | null) {
    setNavTo(p)
    setTripEnd(p ? { lat: p.lat, lng: p.lon } : null)
  }

  function loadDemo(preset: DemoPreset) {
    const place = (id: string) => GUNTUR_PLACES.find((p) => p.id === id)!
    const from = place(preset.fromPlaceId)
    const to = place(preset.toPlaceId)
    const first = place(preset.events[0].placeId)

    pickFrom({ lat: from.lat, lon: from.lng, label: from.name })
    pickTo({ lat: to.lat, lon: to.lng, label: to.name })
    setEvents([])
    setSimulationResult(null)
    setTimeOverride(null)
    setEventPin({ lat: first.lat, lng: first.lng, name: preset.events[0].name, radiusMeters: preset.events[0].radiusMeters })
    setMapClickMode("route")
    setAwaitingClosurePoint(null)
    setClosurePoints(null)
    setFlyTo({ lat: GUNTUR_CENTER.lat, lng: GUNTUR_CENTER.lng, zoom: 14, nonce: Date.now() })
    setDemoMenuOpen(false)
    setPendingDemo(preset)
  }

  // Google-Maps-style point picking: 1st click = start (A), 2nd = end (B),
  // 3rd click starts a fresh trip.
  async function handleMapClick(p: LatLng) {
    if (awaitingClosurePoint !== null) {
      if (awaitingClosurePoint === 0) {
        setClosurePoints([{ lat: p.lat, lng: p.lng }, { lat: p.lat, lng: p.lng }])
        setAwaitingClosurePoint(1)
      } else {
        setClosurePoints((previous) => previous ? [previous[0], { lat: p.lat, lng: p.lng }] : null)
        setAwaitingClosurePoint(null)
      }
      return
    }

    if (mapClickMode === "event") {
      const inBounds =
        p.lat >= GUNTUR_BOUNDS.minLat && p.lat <= GUNTUR_BOUNDS.maxLat &&
        p.lng >= GUNTUR_BOUNDS.minLng && p.lng <= GUNTUR_BOUNDS.maxLng
      if (!inBounds) {
        setOutOfBoundsWarning(true)
        return
      }
      setOutOfBoundsWarning(false)
      if (events.length >= MAX_EVENTS) {
        setEventCapWarning(true)
        return
      }
      setEventCapWarning(false)
      setEventPin({ lat: p.lat, lng: p.lng, name: "Event Location", radiusMeters: 500 })
      return
    }

    if (mapClickMode === "scenario") {
      // Guard against the button-activation click bubbling through to the map
      if (Date.now() - scenarioModeActivatedAt.current < 400) return
      setScenarioPin({ lat: p.lat, lon: p.lng })
      setMapClickMode("route")
      return
    }

    // While navigating, a click means "I'm here now" — drives the
    // off-route/reroute path on desktop where there is no moving GPS.
    if (navigating) {
      geo.setManualFix(p.lat, p.lng)
      return
    }
    const fallback = `${p.lat.toFixed(4)}, ${p.lng.toFixed(4)}`
    const asStart = !navFrom || (navFrom && navTo)
    if (asStart) {
      setNavFrom({ lat: p.lat, lon: p.lng, label: fallback })
      setTripStart(p)
      setNavTo(null)
      setTripEnd(null)
    } else {
      setNavTo({ lat: p.lat, lon: p.lng, label: fallback })
      setTripEnd(p)
    }
    try {
      const res = await fetch(`/api/geocode?lat=${p.lat}&lon=${p.lng}`)
      const body = await res.json()
      const label: string | undefined = body?.place?.name || body?.place?.address?.split(",")[0]
      if (!res.ok || !label) return
      if (asStart) setNavFrom((v) => (v ? { ...v, label } : v))
      else setNavTo((v) => (v ? { ...v, label } : v))
    } catch {
      // keep coordinate label if reverse geocoding fails
    }
  }

  // Only stops that were actually resolved to coordinates are routable.
  const validStops = useMemo(() => navStops.filter((w) => w.lat !== 0 || w.lon !== 0), [navStops])

  // Real routing (OSRM over OpenStreetMap)
  const nav = useNavigationRoute(navFrom, navTo, travelMode, validStops)
  const activeRouteId = nav.routes.some((r) => r.id === activeNavId) ? activeNavId : (nav.routes[0]?.id ?? null)

  // Re-score the routes against ALL simulated events. This runs when more than
  // one event exists, or when the Traffic Time slider sets an hour. With one
  // event and no slider hour (Live), the scheduler's own result is shown.
  const baseResult = simulationResult ?? events[events.length - 1] ?? null
  // The isochrone, emergency and closure checks take a single event. With
  // several, use the one loading the roads most at the evaluated hour.
  const strongestEvent = useMemo((): EventSimulationResponse | null => {
    let best: EventSimulationResponse | null = null
    let bestLoad = -1
    for (const current of events) {
      const phase =
        timeOverride === null
          ? 1
          : eventIntensityAtHour(timeOverride, new Date(current.event.startTime), new Date(current.event.endTime)).intensity
      const load = current.event.eventLoad * phase
      if (load > bestLoad) {
        best = current
        bestLoad = load
      }
    }
    return best ?? simulationResult
  }, [events, timeOverride, simulationResult])
  const eventsSignature = events.map((e) => `${e.event.lat.toFixed(5)},${e.event.lng.toFixed(5)},${e.event.attendance},${e.event.startTime},${e.event.endTime},${e.event.type}`).join("|")
  const [combined, setCombined] = useState<{ signature: string; result: EventSimulationResponse } | null>(null)
  useEffect(() => {
    const needsRescore = events.length > 1 || (events.length === 1 && debouncedHeatmapHour !== null)
    if (!needsRescore || nav.routes.length === 0) {
      setCombined(null)
      return
    }
    const signature = `${eventsSignature}@${debouncedHeatmapHour ?? "peak"}`
    const hour = debouncedHeatmapHour
    const controller = new AbortController()
    async function loadCombined() {
      try {
        const response = await fetch("/api/event/simulate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            events: events.map((e) => ({
              name: e.event.name,
              type: e.event.type,
              lat: e.event.lat,
              lng: e.event.lng,
              locationName: e.event.locationName,
              startTime: e.event.startTime,
              endTime: e.event.endTime,
              attendance: e.event.attendance,
            })),
            routes: nav.routes.map((route) => ({
              id: route.id,
              label: route.label,
              distanceMeters: route.distanceMeters,
              durationSeconds: route.durationSeconds,
              samplePoints: route.latLngs
                .filter((_, index) => index % 3 === 0 || index === route.latLngs.length - 1)
                .map(([lat, lng]) => ({ lat, lng })),
            })),
            ...(hour === null ? {} : { hourOverride: hour }),
          }),
          signal: controller.signal,
        })
        if (!response.ok) throw new Error("Combined event simulation failed")
        setCombined({ signature, result: (await response.json()) as EventSimulationResponse })
      } catch {
        if (!controller.signal.aborted) setCombined(null)
      }
    }
    void loadCombined()
    return () => controller.abort()
    // eventsSignature stands in for `events` (same content, stable identity).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventsSignature, debouncedHeatmapHour, nav.routes])

  // The selected event's result, with its routes replaced by the combined,
  // hour-aware ones when those are available for the current events and hour.
  const displayResult = useMemo((): EventSimulationResponse | null => {
    if (!baseResult) return null
    const signature = `${eventsSignature}@${debouncedHeatmapHour ?? "peak"}`
    if (!combined || combined.signature !== signature) return baseResult
    const { routes, source, note, evaluation, events: combinedEvents } = combined.result
    return { ...baseResult, routes, source, note, evaluation, events: combinedEvents }
  }, [baseResult, combined, eventsSignature, debouncedHeatmapHour])

  useEffect(() => {
    if (!pendingDemo || nav.loading || nav.routes.length === 0 || !eventPin || demoSimulationInFlight.current) return

    const preset = pendingDemo
    const routes = nav.routes
    const timer = window.setTimeout(() => {
      demoSimulationInFlight.current = true
      async function simulateDemoEvents() {
        try {
          const routePayload = routes.map((route) => ({
            id: route.id,
            label: route.label,
            distanceMeters: route.distanceMeters,
            durationSeconds: route.durationSeconds,
            samplePoints: route.latLngs.map(([lat, lng]) => ({ lat, lng })),
          }))
          for (const ev of preset.events) {
            const venue = GUNTUR_PLACES.find((p) => p.id === ev.placeId)!
            const response = await fetch("/api/event/simulate", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                event: {
                  name: ev.name,
                  type: ev.type,
                  lat: venue.lat,
                  lng: venue.lng,
                  locationName: venue.name,
                  startTime: localHourIso(ev.startHour),
                  endTime: localHourIso(ev.endHour),
                  attendance: ev.attendance,
                },
                routes: routePayload,
              }),
            })
            if (!response.ok) throw new Error("Demo event simulation failed")
            commitSimulation((await response.json()) as EventSimulationResponse)
          }
        } catch (error) {
          console.error("Demo event simulation failed:", error)
        } finally {
          demoSimulationInFlight.current = false
          setPendingDemo(null)
        }
      }

      void simulateDemoEvents()
    }, 1200)

    return () => window.clearTimeout(timer)
  }, [pendingDemo, nav.routes, eventPin, nav.loading, commitSimulation])

  // AI decision layer: scores the same trip with traffic, weather + incidents.
  // When event-driven, use the event's location; otherwise use the manually placed scenario pin.
  const intelIncidentLocation = eventDriven ? eventIncidentLocation : scenarioPin
  const intel = useRouteIntel(navFrom, navTo, travelMode, validStops, intelScenario, timeOverride, intelIncidentLocation)
  const scenarioActive = intelScenario.type !== "none" && !!intel.scenario

  useEffect(() => {
    const recommendedId = eventDriven ? intel.intel?.recommendation?.routeId : null
    if (recommendedId && nav.routes.some((route) => route.id === recommendedId)) setActiveNavId(recommendedId)
  }, [eventDriven, intel.intel?.recommendation?.routeId, nav.routes])

  // Device location + live navigation session (progress, off-route, reroute).
  const geo = useGeolocation()
  const session = useNavSession({
    routes: nav.routes,
    selectedRouteId: activeRouteId,
    destination: navTo,
    waypoints: validStops,
    mode: travelMode,
    fix: geo.fix,
  })

  const navigating = session.state === "navigating" || session.state === "rerouting"

  // Track continuously only while navigating; release the watcher otherwise.
  useEffect(() => {
    if (navigating) geo.startWatch()
    else geo.stopWatch()
  }, [navigating]) // eslint-disable-line react-hooks/exhaustive-deps

  /** Sets the live position as the routing origin. */
  function useMyLocation() {
    geo.locateOnce()
  }
  // Once a fix lands from the "My location" button, adopt it as origin A.
  const adoptedFix = useRef(false)
  useEffect(() => {
    if (!geo.fix || navigating || adoptedFix.current) return
    adoptedFix.current = true
    const p: NavPoint = { lat: geo.fix.lat, lon: geo.fix.lon, label: "My location" }
    setNavFrom(p)
    setTripStart({ lat: p.lat, lng: p.lon })
    setFlyTo({ lat: p.lat, lng: p.lon, zoom: 15, nonce: Date.now() })
  }, [geo.fix, navigating])
  useEffect(() => {
    if (!geo.fix) adoptedFix.current = false
  }, [geo.fix])

  /** POI "Directions": the POI becomes B, origin stays A (or the live fix). */
  function poiDirections(p: NavPoint) {
    if (!navFrom && geo.fix) {
      setNavFrom({ lat: geo.fix.lat, lon: geo.fix.lon, label: "My location" })
      setTripStart({ lat: geo.fix.lat, lng: geo.fix.lon })
    }
    setNavTo(p)
    setTripEnd({ lat: p.lat, lng: p.lon })
    setActiveNavId(null)
  }

  // While rerouted, draw the recalculated line instead of the stale plan.
  const drawnRoutes = useMemo(() => {
    if (session.isRerouted && session.route) {
      return [{ id: session.route.id, label: session.route.label, latLngs: session.route.latLngs }]
    }
    // A simulated closure/flood forces a genuine engine re-route — draw that.
    if (scenarioActive && intel.scenario?.rerouted && intel.routes.length > 0) {
      return intel.routes.map((r) => ({ id: r.id, label: `${r.label} (scenario)`, latLngs: r.latLngs }))
    }
    return nav.routes.map((r) => ({ id: r.id, label: r.label, latLngs: r.latLngs }))
  }, [session.isRerouted, session.route, nav.routes, scenarioActive, intel.scenario?.rerouted, intel.routes])

  // POI search anchor: live position first, else chosen origin, else viewport.
  const poiCenter = geo.fix
    ? { lat: geo.fix.lat, lon: geo.fix.lon }
    : navFrom
      ? { lat: navFrom.lat, lon: navFrom.lon }
      : place
        ? { lat: place.lat, lon: place.lng }
        : null

  const isochroneOrigin = tripStart ?? (eventPin ? { lat: eventPin.lat, lng: eventPin.lng } : null)

  // ── Route metrics: each value is tagged with where it came from ──────────
  const activeRoute = nav.routes.find((r) => r.id === activeRouteId) ?? nav.routes[0] ?? null

  // Ambient air quality for the city centre (Copernicus CAMS via Open-Meteo).
  // It is background data and does not react to simulated events.
  const [ambientAqi, setAmbientAqi] = useState<number | null>(null)
  useEffect(() => {
    const controller = new AbortController()
    fetch(`/api/air-quality?lat=${GUNTUR_CENTER.lat}&lng=${GUNTUR_CENTER.lng}`, { signal: controller.signal })
      .then((response) => (response.ok ? response.json() : null))
      .then((data: { aqi?: unknown } | null) => setAmbientAqi(typeof data?.aqi === "number" ? data.aqi : null))
      .catch(() => {
        if (!controller.signal.aborted) setAmbientAqi(null)
      })
    return () => controller.abort()
  }, [])

  const routeMetrics = useMemo(() => {
    // The prediction for the active route (matched by id, then by label), from
    // the combined / hour-aware result when one exists.
    const simulated = activeRoute
      ? (displayResult?.routes.find((candidate) => candidate.routeId === activeRoute.id) ??
        displayResult?.routes.find((candidate) => candidate.label.trim().toLowerCase() === activeRoute.label.trim().toLowerCase()) ??
        null)
      : null
    const intelScoreRow = intel.intel?.scores.find((s) => s.id === activeRoute?.id) ?? intel.intel?.scores[0]
    const intelScore = intelScoreRow ? intelScoreRow.trafficLevel * 100 : null
    return computeRouteMetrics({
      route: activeRoute,
      simulated,
      intelCongestionPct: typeof intelScore === "number" ? intelScore : null,
      incidentCount: intel.incidents?.length ?? 0,
      aqi: ambientAqi,
    })
  }, [activeRoute, displayResult, intel.intel, intel.incidents, ambientAqi])

  return (
    <main className="flex h-screen flex-col overflow-hidden bg-background text-foreground md:flex-row">
      {/* Map area */}
      <div className="relative min-h-0 flex-1">
        <div className="absolute inset-0 z-0">
          <CityMap
            basemap={basemap}
            layers={layers}
            flyTo={flyTo}
            tripStart={tripStart}
            tripEnd={tripEnd}
            onMapClick={handleMapClick}
            showStudyArea={mapClickMode === "event"}
            navRoutes={drawnRoutes}
            activeNavId={session.isRerouted ? drawnRoutes[0]?.id : activeRouteId}
            currentPos={geo.fix ? { lat: geo.fix.lat, lng: geo.fix.lon, accuracy: geo.fix.accuracy } : null}
            snappedPos={
              session.progress
                ? { lat: session.progress.snapped[0], lng: session.progress.snapped[1] }
                : null
            }
            followPos={navigating && session.follow}
            navigating={navigating}
            waypoints={validStops.map((w) => ({ lat: w.lat, lng: w.lon }))}
            pois={pois.map((p) => ({ id: p.id, name: p.name, lat: p.lat, lon: p.lon }))}
            geoIncidents={intel.incidents}
            eventPin={eventPin}
            otherEvents={events
              .filter((e) => !eventPin || eventKey(e.event.lat, e.event.lng) !== eventKey(eventPin.lat, eventPin.lng))
              .map((e) => ({ id: e.event.id, lat: e.event.lat, lng: e.event.lng, name: e.event.name, radiusMeters: e.event.impactRadiusMeters }))}
            simulationResult={simulationResult}
            heatmapSegments={heatmapSegments}
            heatMode={heatMode}
            isochroneNormal={isochroneNormal}
            isochroneAffected={isochroneAffected}
            emergencyRoute={emergencyRoute}
            planOverlay={planOverlay}
            closurePoints={closurePoints}
            onLocate={() => {
              if (geo.fix) setFlyTo({ lat: geo.fix.lat, lng: geo.fix.lon, zoom: 16, nonce: Date.now() })
              else geo.locateOnce()
            }}
          />
        </div>

        {/* overlay header */}
        <header className="pointer-events-none absolute inset-x-0 top-0 z-30 flex items-start justify-between gap-3 p-4">
          <div className="pointer-events-auto flex items-center gap-3 rounded-xl border border-border bg-card px-3 py-2 backdrop-blur-md">
            <div>
              <h1 className="font-mono text-sm font-semibold tracking-tight text-balance">
                ROUTE<span className="text-primary">CAST</span>
              </h1>
              <p className="text-[10px] text-muted-foreground">Guntur Digital Twin</p>
            </div>
            <a
              href="/presentation"
              className="rounded-full border border-primary/50 px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider text-primary transition-colors hover:bg-primary/10"
            >
              Deck
            </a>
            <span
              title={osrmStatus === "ok" ? "OSRM routing server online" : osrmStatus === "checking" ? "Checking routing server…" : "OSRM routing server unreachable"}
              className="flex items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-1 font-mono text-[9px] uppercase tracking-wider text-muted-foreground backdrop-blur-md"
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${osrmStatus === "ok" ? "bg-green-400" : osrmStatus === "checking" ? "bg-yellow-400 animate-pulse" : "bg-red-400"}`}
              />
              OSRM
            </span>
          </div>

          <div className="pointer-events-auto flex items-center gap-2">
            <div className="relative">
              <button
                type="button"
                onClick={() => setDemoMenuOpen((open) => !open)}
                aria-expanded={demoMenuOpen}
                className="flex items-center gap-1.5 rounded-full border border-primary/60 bg-primary/10 px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-widest text-primary backdrop-blur-md transition-colors hover:bg-primary/20"
              >
                ▶ Demo ▾
              </button>
              {demoMenuOpen && (
                <div className="absolute right-0 top-full z-50 mt-2 w-72 rounded-xl border border-border bg-card/95 p-1.5 shadow-lg backdrop-blur-md">
                  {DEMO_PRESETS.map((preset) => (
                    <button
                      key={preset.id}
                      type="button"
                      onClick={() => loadDemo(preset)}
                      className="block w-full rounded-lg px-3 py-2 text-left hover:bg-primary/10"
                    >
                      <span className="block font-mono text-[11px] uppercase tracking-wider text-primary">{preset.label}</span>
                      <span className="mt-0.5 block text-[10px] leading-snug text-muted-foreground">{preset.shows}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={() => {
                navigator.clipboard.writeText(window.location.href).catch(() => null)
                const toast = document.getElementById("share-toast")
                if (toast) {
                  toast.style.opacity = "1"
                  setTimeout(() => { toast.style.opacity = "0" }, 1800)
                }
              }}
              className="flex items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-widest text-foreground backdrop-blur-md transition-colors hover:border-primary"
              title="Copy shareable link"
            >
              🔗 Share
            </button>
            <span
              id="share-toast"
              aria-live="polite"
              className="pointer-events-none rounded-full bg-primary/10 px-2.5 py-1 font-mono text-[9px] text-primary transition-opacity duration-500"
              style={{ opacity: 0 }}
            >
              Link copied!
            </span>
            {/* Event placement mode indicator */}
            {mapClickMode === "event" && (
              <span className="rounded-full border border-primary bg-primary/10 px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-widest text-primary backdrop-blur-md animate-pulse">
                Click map to place event
              </span>
            )}
            {/* Scenario incident pin indicator */}
            {mapClickMode === "scenario" && (
              <span className="rounded-full border border-destructive bg-destructive/10 px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-widest text-destructive backdrop-blur-md animate-pulse">
                Click map to place incident
              </span>
            )}
            {eventCapWarning && (
              <span role="alert" className="rounded-full border border-amber-400/50 bg-amber-400/10 px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-widest text-amber-300 backdrop-blur-md">
                Maximum {MAX_EVENTS} events — remove one first
              </span>
            )}
            {outOfBoundsWarning && (
              <div
                role="alert"
                className="flex items-center gap-2 rounded-full border border-destructive/60 bg-destructive/10 px-3 py-1.5 font-mono text-[10px] text-destructive backdrop-blur-md"
              >
                ⚠ Outside Guntur study area — tap inside the city
                <button
                  type="button"
                  aria-label="Dismiss"
                  onClick={() => setOutOfBoundsWarning(false)}
                  className="ml-1 opacity-60 hover:opacity-100"
                >
                  ×
                </button>
              </div>
            )}
            {awaitingClosurePoint !== null && (
              <span className="rounded-full border border-destructive bg-destructive/10 px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-widest text-destructive backdrop-blur-md animate-pulse">
                Click map — closure point {awaitingClosurePoint === 0 ? "A" : "B"}
              </span>
            )}

            <button
              onClick={() => setBasemap(isSatellite ? "dark" : "hybrid")}
              aria-label={isSatellite ? "Switch to neon view" : "Switch to satellite view"}
              className="flex items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-widest text-foreground backdrop-blur-md transition-colors hover:border-primary"
            >
              {isSatellite ? <Moon className="h-3.5 w-3.5" /> : <Satellite className="h-3.5 w-3.5 text-primary" />}
              {isSatellite ? "Neon" : "Satellite"}
            </button>
          </div>
        </header>

        {/* Location search + A/B route status bar */}
        <div className="absolute left-1/2 top-20 z-20 flex -translate-x-1/2 flex-col items-center gap-1.5">
          <LocationSearch onSelect={handlePlace} />

          {place && (
            <span className="pointer-events-none rounded-full border border-border bg-card px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider text-primary backdrop-blur-md">
              Viewing · {place.label.split(",").slice(0, 2).join(", ")}
            </span>
          )}

          <div className="pointer-events-auto flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 font-mono text-[10px] text-muted-foreground backdrop-blur-md">
            {navigating ? (
              <span className="text-primary">Click map to move your position</span>
            ) : (
              <>
                <span className={tripStart ? "text-primary" : ""}>A {tripStart ? "set" : "· click map"}</span>
                <span className="text-border">|</span>
                <span className={tripEnd ? "text-primary" : ""}>B {tripEnd ? "set" : "· click map"}</span>
              </>
            )}
            {validStops.length > 0 && <span className="text-primary">· {validStops.length} stop(s)</span>}
            {(tripStart || tripEnd) && (
              <button
                onClick={() => {
                  setTripStart(null)
                  setTripEnd(null)
                  setIsochroneNormal([])
                  setIsochroneAffected([])
                  setNavFrom(null)
                  setNavTo(null)
                  setActiveNavId(null)
                  setNavStops([])
                  setPois([])
                  session.stop()
                  geo.clearFix()
                }}
                className="ml-1 rounded-full border border-border px-1.5 uppercase tracking-wider hover:border-primary hover:text-foreground"
              >
                Reset
              </button>
            )}
          </div>
        </div>

        {/* Layer + basemap controls */}
        <div className="absolute right-4 top-20 z-10 flex flex-col items-end gap-1.5">
          <button
            onClick={() => setLayersOpen((o) => !o)}
            aria-expanded={layersOpen}
            className="flex items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-widest text-foreground backdrop-blur-md transition-colors hover:border-primary"
          >
            <Layers className="h-3.5 w-3.5 text-primary" aria-hidden />
            Layers
          </button>
          {layersOpen && (
            <LayerControls basemap={basemap} onBasemap={setBasemap} layers={layers} onLayers={setLayers} />
          )}
        </div>

        {/* Map toolbar: Place Event toggle */}
        <div className="pointer-events-auto absolute bottom-16 right-4 z-10 flex flex-col items-end gap-1.5">
          <button
            onClick={() => setMapClickMode((m) => (m === "event" ? "route" : "event"))}
            className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-widest backdrop-blur-md transition-colors ${
              mapClickMode === "event"
                ? "border-primary bg-primary/10 text-primary"
                : "border-border bg-card text-foreground hover:border-primary"
            }`}
          >
            📍 Place Event
          </button>
          {events.map((e) => (
            <span
              key={e.event.id}
              className="flex items-center gap-1.5 rounded-full border border-violet-400/40 bg-card px-2.5 py-1 font-mono text-[9px] uppercase tracking-wider text-foreground backdrop-blur-md"
            >
              <span aria-hidden>📍</span>
              <span className="max-w-[9rem] truncate">{e.event.name}</span>
              <button
                type="button"
                aria-label={`Remove event ${e.event.name}`}
                onClick={() => {
                  removeEventAt(e.event.lat, e.event.lng)
                  setEventCapWarning(false)
                }}
                className="text-muted-foreground hover:text-destructive"
              >
                ×
              </button>
            </span>
          ))}
          {eventPin && (
            <button
              onClick={() => {
                removeEventAt(eventPin.lat, eventPin.lng)
                setEventPin(null)
                setSimulationResult(null)
                setEventCapWarning(false)
              }}
              className="rounded-full border border-border bg-card px-2.5 py-1 font-mono text-[9px] uppercase tracking-wider text-muted-foreground backdrop-blur-md hover:border-destructive hover:text-destructive"
            >
              Clear Pin
            </button>
          )}
        </div>

        {/* Live turn-by-turn HUD */}
        {session.route && session.state !== "idle" && session.state !== "route_ready" && (
          <div className="pointer-events-none absolute inset-x-0 bottom-16 z-20 flex justify-center px-3">
            <NavHud
              state={session.state}
              route={session.route}
              progress={session.progress}
              error={session.error}
              rerouteCount={session.rerouteCount}
              isRerouted={session.isRerouted}
              follow={session.follow}
              onFollow={session.setFollow}
              onStop={session.stop}
              onRetry={session.retry}
              simulated={geo.isSimulated}
            />
          </div>
        )}

        {/* Awaiting the first GPS fix after pressing Start */}
        {navigating && !geo.fix && (
          <div className="pointer-events-none absolute inset-x-0 bottom-16 z-20 flex justify-center px-3">
            <p className="rounded-full border border-primary/40 bg-card px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider text-primary backdrop-blur-md">
              Waiting for GPS fix…
            </p>
          </div>
        )}

        {/* Map-only view indicator at bottom */}
        <div className="pointer-events-auto absolute bottom-4 left-1/2 z-10 flex -translate-x-1/2 gap-1 rounded-xl border border-border bg-card p-1 backdrop-blur-md">
          <span className="rounded-lg px-3 py-1.5 font-mono text-[11px] uppercase tracking-wider bg-primary text-primary-foreground">
            Map
          </span>
        </div>
      </div>

      {/* Sidebar — always visible, always showing real-road panels */}
      <aside className="h-[50vh] w-full overflow-y-auto border-t border-border bg-background p-5 md:h-screen md:w-96 md:border-l md:border-t-0">
        <div className="flex flex-col gap-7">
          {/* 1. Navigation (route A → B) */}
          <NavigationPanel
            from={navFrom}
            to={navTo}
            onFrom={pickFrom}
            onTo={pickTo}
            mode={travelMode}
            onMode={setTravelMode}
            routes={nav.routes}
            simulationResult={displayResult}
            activeRouteId={activeRouteId}
            onActiveRoute={setActiveNavId}
            loading={nav.loading}
            error={nav.error}
            isFromCache={nav.isFromCache}
            engine={nav.engine}
            trafficNote={nav.trafficNote}
            waypoints={navStops}
            onWaypoints={setNavStops}
            gpsStatus={geo.status}
            gpsMessage={geo.message}
            onUseMyLocation={useMyLocation}
            navState={session.state}
            onStartNav={() => {
              geo.startWatch()
              session.start()
            }}
          />

          <TimeSlider value={timeOverride} onChange={setTimeOverride} simulationResult={baseResult} />

          {heatmapSegments.some((s) => s.baseCongestion !== undefined) && (
            <div className="rounded-xl border border-border bg-card/50 p-3">
              <h2 className="font-mono text-xs uppercase tracking-widest text-primary">Before / After</h2>
              <div className="mt-2 grid grid-cols-3 gap-1" role="group" aria-label="Heatmap view">
                {([["normal", "Before"], ["event", "After"], ["change", "Change"]] as const).map(([mode, label]) => (
                  <button
                    key={mode}
                    type="button"
                    aria-pressed={heatMode === mode}
                    onClick={() => setHeatMode(mode)}
                    className={`rounded-md border px-2 py-1 font-mono text-[10px] uppercase tracking-wider ${heatMode === mode ? "border-primary bg-primary/15 text-primary" : "border-border text-muted-foreground hover:text-foreground"}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <p className="mt-2 text-[10px] text-muted-foreground">
                Before = normal traffic at this hour. After = with the event. Change = extra seconds per road the event adds. Modeled, same BPR model for both.
              </p>
            </div>
          )}

          {/* 2. Route intelligence (AI scoring + weather + risk) */}
          <RouteIntelPanel
            intel={intel.intel}
            loading={intel.loading}
            error={intel.error}
            simulated={scenarioActive}
            eventDriven={eventDriven}
            activeRouteId={activeRouteId}
            onSelectRoute={setActiveNavId}
          />

          {events.length > 1 && strongestEvent && (
            <p className="rounded-md border border-border bg-card/40 px-2 py-1 font-mono text-[10px] text-muted-foreground">
              Reachability, emergency and closure checks use the event loading the roads most at the chosen time:{" "}
              <span className="text-foreground">{strongestEvent.event.name}</span> (1 of {events.length}).
            </p>
          )}

          <IsochronePanel
            origin={isochroneOrigin}
            mode={travelMode}
            simulationResult={strongestEvent}
            onIsochrone={(normal, affected) => {
              setIsochroneNormal(normal)
              setIsochroneAffected(affected)
            }}
            onClear={() => {
              setIsochroneNormal([])
              setIsochroneAffected([])
            }}
          />

          <EmergencyPanel
            simulationResult={strongestEvent}
            timeOverride={timeOverride}
            onEmergencyRoute={setEmergencyRoute}
            onClear={() => setEmergencyRoute([])}
          />

          {/* 3. What-if scenario simulator */}
          <WhatIfPanel
            scenario={intelScenario}
            onScenario={(nextScenario) => {
              eventDrivenRef.current = false
              setEventDriven(false)
              setEventIncidentLocation(null)
              setIntelScenario(nextScenario)
            }}
            baseline={intel.baseline}
            result={intel.scenario}
            loading={intel.loading}
            ready={!!navFrom && !!navTo}
            simulationResult={strongestEvent}
            eventDriven={eventDriven}
            closurePoints={closurePoints}
            onClosurePoints={(points) => {
              setClosurePoints(points)
              if (points === null) setAwaitingClosurePoint(closurePoints === null ? 0 : null)
            }}
            scenarioPin={scenarioPin}
            onPlacePin={() => {
              scenarioModeActivatedAt.current = Date.now()
              setMapClickMode("scenario")
            }}
            onClearPin={() => setScenarioPin(null)}
          />

          {/* 4. POI search */}
          <PoiPanel
            center={poiCenter}
            centerLabel={geo.fix ? "my location" : navFrom?.label || place?.label?.split(",")[0]}
            pois={pois}
            onPois={setPois}
            onDirections={poiDirections}
            onAddStop={(p) => setNavStops((w) => [...w, p])}
            onFocus={(p) => setFlyTo({ lat: p.lat, lng: p.lon, zoom: 16, nonce: Date.now() })}
          />

          <EventSchedulerPanel
            eventPin={eventPin}
            onEventPin={(pin) => {
              // Moving the selected pin (e.g. picking a place) drops the event simulated at its old spot.
              if (eventPin && (!pin || eventKey(pin.lat, pin.lng) !== eventKey(eventPin.lat, eventPin.lng))) {
                removeEventAt(eventPin.lat, eventPin.lng)
              }
              setEventPin(pin)
            }}
            routes={nav.routes.map((route) => ({
              id: route.id,
              label: route.label,
              distanceMeters: route.distanceMeters,
              durationSeconds: route.durationSeconds,
              latLngs: route.latLngs,
            }))}
            onSimulationResult={commitSimulation}
            onClearEvent={() => {
              if (eventPin) removeEventAt(eventPin.lat, eventPin.lng)
            }}
            eventCount={events.length}
            maxEvents={MAX_EVENTS}
          />
          <ImpactDashboard result={displayResult} />

          <OrganizerPlanPanel event={strongestEvent?.event ?? null} onOverlay={setPlanOverlay} />

          {/* 6. Live city metrics */}
          <MetricsDashboard metrics={routeMetrics} />
        </div>
      </aside>
    </main>
  )
}

function ViewLoading({ label }: { label: string }) {
  return (
    <div className="flex h-full w-full items-center justify-center bg-background">
      <span className="font-mono text-xs uppercase tracking-widest text-muted-foreground">{label}…</span>
    </div>
  )
}
