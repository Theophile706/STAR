import type { BarleyDetectionConfig } from "@/lib/barley-detection";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3001";

export interface AutomaticParcelAnalysis {
  is_barley?: boolean;
  barley_presence?: "confirmed" | "probable" | "none";
  culture_detected?: string;
  verdict?: string;
  confidence?: number;
  percentage?: number;
  details?: string;
  data_source?: string;
  hf_model_url?: string;
  hf_available?: boolean;
  gdd_cumulative?: number;
  gdd_threshold?: number;
  gdd_base_temperature?: number;
  gdd_start_date?: string;
  gdd_end_date?: string;
  gdd_detected?: boolean;
  gdd_daily_values?: Array<{ date: string; tmax: number; tmin: number; dj: number }>;
  gdd_error?: string | null;
}

export interface AutomaticParcel {
  id: string;
  coordinates: Array<{ lat: number; lng: number }>;
  center: { lat: number; lng: number };
  tags: Record<string, string>;
  analysis: AutomaticParcelAnalysis | null;
  analysis_error: string | null;
}

export interface AutomaticParcelSearchResult {
  center: { lat: number; lng: number };
  radius_km: number;
  base_temperature: number;
  threshold: number;
  period_days: number;
  candidates_found: number;
  analyzed_count: number;
  parcels: AutomaticParcel[];
  notice: string | null;
}

export async function searchAutomaticParcels(lat: number, lng: number, radiusKm: number, config: BarleyDetectionConfig): Promise<AutomaticParcelSearchResult> {
  const response = await fetch(`${API_URL}/api/detect-parcels`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ lat, lng, radiusKm, ...config }),
  });
  const text = await response.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!response.ok) {
    const message = data && typeof data === "object" && "error" in data && typeof data.error === "string"
      ? data.error
      : `La recherche automatique est indisponible (${response.status}).`;
    throw new Error(message);
  }
  if (!data || typeof data !== "object") throw new Error("La recherche a renvoyé une réponse invalide.");
  return data as AutomaticParcelSearchResult;
}

export function isAutomaticBarleyParcel(parcel: AutomaticParcel): boolean {
  const culture = parcel.analysis?.culture_detected?.toLowerCase() ?? "";
  return parcel.analysis?.is_barley === true || (culture.includes("orge") && !culture.includes("non"));
}
