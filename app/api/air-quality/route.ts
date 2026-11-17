/**
 * GET /api/air-quality?lat=..&lng=..
 *
 * Ambient air quality (US AQI) for a point, from the Open-Meteo Air Quality API
 * (Copernicus CAMS model data). Returns { aqi: null } when the feed is
 * unavailable so the UI can show "no data" instead of an invented number.
 */

import { NextResponse } from "next/server"
import { fetchAmbientAqi } from "@/lib/air-quality"

export async function GET(request: Request): Promise<NextResponse> {
  const { searchParams } = new URL(request.url)
  const lat = Number(searchParams.get("lat"))
  const lng = Number(searchParams.get("lng"))
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return NextResponse.json({ error: "lat and lng are required" }, { status: 400 })
  }

  const data = await fetchAmbientAqi(lat, lng)
  return NextResponse.json(
    data
      ? { ...data, source: "Copernicus CAMS via Open-Meteo" }
      : { aqi: null, pm25: null, time: null, source: "Copernicus CAMS via Open-Meteo", note: "Air-quality feed unavailable" },
    { headers: { "Cache-Control": "public, max-age=900" } },
  )
}
