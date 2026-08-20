import { useEffect, useState, useCallback } from "react";
const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3001";

export interface TimeSeriesPointS2 {
  date: string;
  ndvi: number | null;
  cloud_cover: number | null;
}

export interface TimeSeriesPointS1 {
  date: string;
  vv: number | null;
  vh: number | null;
}

export interface Parcelle {
  id: string;
  label: string;
  coordinates: Array<{ lat: number; lng: number }>;
  center_lat: number;
  center_lng: number;
  surface_ha: number | null;
  culture_declared: string;
  culture_detected: string | null;
  ndvi_percentage: number | null;
  confidence: number | null;
  verdict: string | null;
  details: string | null;
  saison: string | null;
  soil_type: string | null;
  risk_factors: string[];
  recommendations: string | null;
  data_source: string | null;
  owner_name: string;
  notes: string;
  created_at: string;
  time_series_s2: TimeSeriesPointS2[];
  time_series_s1: TimeSeriesPointS1[];
  estimated_planting_date: string | null;
  estimated_harvest_date: string | null;
  days_since_planting: number | null;
  growth_stage: string | null;
  planting_confidence: number | null;
  // Spectral indices
  evi: number | null;
  savi: number | null;
  ndwi: number | null;
  // Scores
  agro_score: number | null;
  hybrid_score: number | null;
  cnn_prob_barley: number | null;
  cnn_prob_non_barley: number | null;
}

export function useParcelles() {
  const [parcelles, setParcelles] = useState<Parcelle[]>([]);
  const [loading, setLoading] = useState(true);

  const mapRow = (row: unknown): Parcelle => {
    if (!row || typeof row !== "object") throw new Error("Réponse parcelle invalide");
    const value = row as Record<string, unknown>;
    return {
      ...(value as unknown as Parcelle),
      coordinates: value.coordinates as Array<{ lat: number; lng: number }>,
      risk_factors: (value.risk_factors as string[]) || [],
      owner_name: typeof value.owner_name === "string" ? value.owner_name : "",
      notes: typeof value.notes === "string" ? value.notes : "",
      time_series_s2: (value.time_series_s2 as TimeSeriesPointS2[]) || [],
      time_series_s1: (value.time_series_s1 as TimeSeriesPointS1[]) || [],
      estimated_planting_date: typeof value.estimated_planting_date === "string" ? value.estimated_planting_date : null,
      estimated_harvest_date: typeof value.estimated_harvest_date === "string" ? value.estimated_harvest_date : null,
      days_since_planting: typeof value.days_since_planting === "number" ? value.days_since_planting : null,
      growth_stage: typeof value.growth_stage === "string" ? value.growth_stage : null,
      planting_confidence: typeof value.planting_confidence === "number" ? value.planting_confidence : null,
      evi: typeof value.evi === "number" ? value.evi : null,
      savi: typeof value.savi === "number" ? value.savi : null,
      ndwi: typeof value.ndwi === "number" ? value.ndwi : null,
      agro_score: typeof value.agro_score === "number" ? value.agro_score : null,
      hybrid_score: typeof value.hybrid_score === "number" ? value.hybrid_score : null,
      cnn_prob_barley: typeof value.cnn_prob_barley === "number" ? value.cnn_prob_barley : null,
      cnn_prob_non_barley: typeof value.cnn_prob_non_barley === "number" ? value.cnn_prob_non_barley : null,
    };
  };

  const fetchParcelles = useCallback(async () => {
    try {
      const response = await fetch(`${API_URL}/api/parcelles`);
      if (!response.ok) throw new Error("Impossible de charger les parcelles");
      const data: unknown = await response.json();
      if (!Array.isArray(data)) throw new Error("Réponse parcelles invalide");
      setParcelles(data.map(mapRow));
    } catch (error) {
      console.warn("Chargement des parcelles indisponible :", error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchParcelles();
    const interval = window.setInterval(fetchParcelles, 30000);
    return () => window.clearInterval(interval);
  }, [fetchParcelles]);

  const deleteParcelle = useCallback(async (id: string) => {
    const response = await fetch(`${API_URL}/api/parcelles/${id}`, { method: "DELETE" });
    if (!response.ok) throw new Error("Impossible de supprimer la parcelle");
    setParcelles((prev) => prev.filter((p) => p.id !== id));
  }, []);

  const addParcelle = useCallback(async (parcelle: Omit<Parcelle, "id" | "created_at">) => {
    const response = await fetch(`${API_URL}/api/parcelles`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(parcelle),
    });
    if (!response.ok) throw new Error("Impossible d’enregistrer la parcelle");
    const data = await response.json();
    const newP = mapRow(data);
    setParcelles((prev) => [newP, ...prev]);
    return newP;
  }, []);

  return { parcelles, loading, deleteParcelle, addParcelle, refetch: fetchParcelles };
}
