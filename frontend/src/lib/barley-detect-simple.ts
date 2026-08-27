const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3001";

export interface SimpleFieldFeature {
  type: "Feature";
  geometry: { type: "Polygon"; coordinates: number[][][] };
  properties: {
    class: "ORGE";
    confidence: number;
    areaHa: number;
    meanNDVI: number | null;
    meanNDRE: number | null;
    imageDate: string | null;
    imageAgeDays: number | null;
    cloudPercentage: number | null;
  };
}

export interface SimpleAnalysisResult {
  type: "FeatureCollection";
  features: SimpleFieldFeature[];
  analysisId: string | null;
  analysisDate: string;
  center: { lat: number; lng: number };
  radiusM: number;
  imageDate: string | null;
  imageAgeDays: number | null;
  cloudPercentage: number | null;
  imageTimestampMs: number | null;
  confidenceThreshold: number;
  minAreaHa: number;
  candidatesFound: number;
  candidatesClassified: number;
  warnings: string[];
}

/**
 * URL template (z/x/y) pour les tuiles Sentinel-2 de l'image exacte utilisée par une analyse
 * (mode "analyse" uniquement — pas de fond de carte permanent, trop coûteux/fragile pour un
 * pan/zoom libre : voir l'historique de sentinel-tiles.ts).
 */
export function buildSentinel2TileUrlTemplate(imageTimestampMs: number): string {
  return `${API_URL}/api/sentinel-tiles/{z}/{x}/{y}?imageTimestampMs=${imageTimestampMs}`;
}

export async function runSimpleAnalysis(
  lat: number,
  lng: number,
  radiusM: number,
  options?: { confidenceThreshold?: number; minAreaHa?: number },
): Promise<SimpleAnalysisResult> {
  const response = await fetch(`${API_URL}/api/analyze`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ latitude: lat, longitude: lng, radius: radiusM, ...options }),
  });
  return parseSimpleAnalysisResponse(response);
}

export async function fetchLatestSimpleAnalysis(lat: number, lng: number): Promise<SimpleAnalysisResult | null> {
  const response = await fetch(`${API_URL}/api/analyze/latest?lat=${lat}&lng=${lng}`);
  if (response.status === 404) return null;
  return parseSimpleAnalysisResponse(response);
}

async function parseSimpleAnalysisResponse(response: Response): Promise<SimpleAnalysisResult> {
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
      : `L'analyse simple est indisponible (${response.status}).`;
    throw new Error(message);
  }
  if (!data || typeof data !== "object") throw new Error("L'analyse simple a renvoyé une réponse invalide.");
  return data as SimpleAnalysisResult;
}
