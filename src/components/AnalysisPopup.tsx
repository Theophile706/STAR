import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { LineChart, Line, ResponsiveContainer, YAxis, Tooltip } from "recharts";
import type { Parcelle, TimeSeriesPointS2, TimeSeriesPointS1 } from "@/hooks/useParcelles";

type AnalysisStage = "loading" | "percentage" | "verdict" | "error";

export interface AnalysisResultData {
  percentage: number | null;
  is_barley: boolean;
  verdict: string;
  details: string;
  culture_detected: string | null;
  confidence: number | null;
  cnn_prob_barley?: number;
  cnn_prob_non_barley?: number;
  cnn_available?: boolean;
  saison: string | null;
  soil_type: string | null;
  risk_factors: string[];
  recommendations: string | null;
  anomaly_level: string;
  data_source?: string;
  radar_analysis?: string | null;
  spectral_analysis?: string | null;
  time_series_s2?: TimeSeriesPointS2[];
  time_series_s1?: TimeSeriesPointS1[];
  estimated_planting_date?: string | null;
  estimated_harvest_date?: string | null;
  days_since_planting?: number | null;
  growth_stage?: string | null;
  planting_confidence?: number;
  // New fields
  evi?: number | null;
  savi?: number | null;
  ndwi?: number | null;
  agro_score?: number | null;
  agro_breakdown?: { ndvi_score: number; cycle_score: number; radar_score: number; ndvi_trend_score: number };
  agro_details?: string;
  hybrid_score?: number | null;
  warnings?: string[];
  boundary_source?: string;
}

interface AnalysisPopupProps {
  position: { x: number; y: number };
  polygon: Array<{ lat: number; lng: number }>;
  center: { lat: number; lng: number };
  zoom: number;
  onClose: () => void;
  onSave: (parcelle: Omit<Parcelle, "id" | "created_at">) => Promise<Parcelle | null>;
  ownerName: string;
  notes: string;
}

const ANALYSIS_URL = `${import.meta.env.VITE_API_URL ?? "http://localhost:3001"}/api/analyze-parcel`;

function computeSurfaceHa(points: Array<{ lat: number; lng: number }>): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const R = 6371000;
  const centerLat = points.reduce((s, p) => s + p.lat, 0) / points.length;
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const j = (i + 1) % points.length;
    const xi = points[i].lng * Math.cos(toRad(centerLat)) * (Math.PI / 180) * R;
    const yi = points[i].lat * (Math.PI / 180) * R;
    const xj = points[j].lng * Math.cos(toRad(centerLat)) * (Math.PI / 180) * R;
    const yj = points[j].lat * (Math.PI / 180) * R;
    area += xi * yj - xj * yi;
  }
  return Math.abs(area / 2) / 10000;
}

function growthStageEmoji(stage: string | null | undefined): string {
  if (!stage) return "🌱";
  const s = stage.toLowerCase();
  if (s.includes("semis")) return "🌱";
  if (s.includes("levée")) return "🌿";
  if (s.includes("tallage")) return "🌾";
  if (s.includes("montaison")) return "📈";
  if (s.includes("épiaison")) return "🌾";
  if (s.includes("maturation")) return "🟡";
  if (s.includes("récolte")) return "✂️";
  return "🌱";
}

function scoreColor(score: number): string {
  if (score >= 70) return "text-emerald-400";
  if (score >= 40) return "text-amber-400";
  return "text-red-400";
}

export default function AnalysisPopup({ position, polygon, center, zoom, onClose, onSave, ownerName, notes }: AnalysisPopupProps) {
  const [stage, setStage] = useState<AnalysisStage>("loading");
  const [result, setResult] = useState<AnalysisResultData | null>(null);
  const [displayPct, setDisplayPct] = useState<number | null>(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function analyze() {
      try {
        const resp = await fetch(ANALYSIS_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ lat: center.lat, lng: center.lng, zoom, polygon }),
        });

        if (!resp.ok) {
          const err = await resp.json().catch(() => ({ error: "Erreur réseau" }));
          throw new Error(err.error || `Erreur ${resp.status}`);
        }

        const data: AnalysisResultData = await resp.json();
        if (cancelled) return;

        setResult(data);
        setStage("percentage");

        const surface = computeSurfaceHa(polygon);
        await onSave({
          label: ownerName || "",
          coordinates: polygon,
          center_lat: center.lat,
          center_lng: center.lng,
          surface_ha: Math.round(surface * 100) / 100,
          culture_declared: "Orge",
          culture_detected: data.culture_detected,
          ndvi_percentage: data.percentage,
          confidence: data.confidence,
          verdict: data.verdict,
          details: data.details,
          saison: data.saison,
          soil_type: data.soil_type,
          risk_factors: data.risk_factors,
          recommendations: data.recommendations,
          data_source: data.data_source ?? null,
          owner_name: ownerName || "",
          notes: notes || "",
          time_series_s2: data.time_series_s2 || [],
          time_series_s1: data.time_series_s1 || [],
          estimated_planting_date: data.estimated_planting_date || null,
          estimated_harvest_date: data.estimated_harvest_date || null,
          days_since_planting: data.days_since_planting ?? null,
          growth_stage: data.growth_stage || null,
          planting_confidence: data.planting_confidence ?? null,
          evi: data.evi ?? null,
          savi: data.savi ?? null,
          ndwi: data.ndwi ?? null,
          agro_score: data.agro_score ?? null,
          hybrid_score: data.hybrid_score ?? null,
          cnn_prob_barley: data.cnn_prob_barley ?? null,
          cnn_prob_non_barley: data.cnn_prob_non_barley ?? null,
        });
        if (!cancelled) setSaved(true);

        setTimeout(() => {
          if (!cancelled) setStage("verdict");
        }, 1800);
      } catch (e) {
        if (cancelled) return;
        setErrorMsg(e instanceof Error ? e.message : "Erreur inconnue");
        setStage("error");
      }
    }

    analyze();
    return () => { cancelled = true; };
  }, [center.lat, center.lng, notes, onSave, ownerName, polygon, zoom]);

  useEffect(() => {
    if (stage === "percentage" && result) {
      let current = 0;
      const target = result.percentage;
      if (target == null) {
        setDisplayPct(null);
        return;
      }
      const step = Math.max(1, Math.floor(target / 30));
      const interval = setInterval(() => {
        current = Math.min(current + step, target);
        setDisplayPct(current);
        if (current >= target) clearInterval(interval);
      }, 40);
      return () => clearInterval(interval);
    }
  }, [stage, result]);

  const barColor = (pct: number) =>
    pct >= 70 ? "bg-vegetation-high" : pct >= 40 ? "bg-vegetation-medium" : pct >= 20 ? "bg-vegetation-low" : "bg-vegetation-none";

  const sparklineData = result?.time_series_s2
    ?.filter((p) => p.ndvi != null)
    .map((p) => ({ date: p.date, ndvi: p.ndvi })) || [];

  return (
    <motion.div
      initial={{ opacity: 0, y: 20, scale: 0.85 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -10, scale: 0.9 }}
      transition={{ type: "spring", damping: 25, stiffness: 350 }}
      className="analysis-popup absolute z-[1000] w-[340px] p-4"
      style={{ left: position.x, top: position.y, transform: "translate(-50%, -100%)", marginTop: "-12px" }}
    >
      <div className="absolute left-1/2 -translate-x-1/2 -bottom-2 w-4 h-4 rotate-45 bg-card/95 border-r border-b border-border" />

      <button
        onClick={onClose}
        className="absolute top-2 right-2 w-6 h-6 flex items-center justify-center rounded-full bg-muted text-muted-foreground hover:text-foreground transition-colors text-xs"
      >
        ✕
      </button>

      <div className="flex items-center gap-2 mb-3">
        <div className="w-2 h-2 rounded-full bg-primary animate-pulse" />
        <span className="text-xs text-muted-foreground mono uppercase tracking-wider">Analyse — {result?.data_source ?? ""}</span>
      </div>

      <div className="text-xs text-muted-foreground mono mb-3">
        {center.lat.toFixed(5)}, {center.lng.toFixed(5)} · {polygon.length} pts
      </div>
      {result?.boundary_source && (
        <p className="mb-3 text-[11px] text-muted-foreground">{result.boundary_source}</p>
      )}

      {result?.warnings && result.warnings.length > 0 && (
        <div className="mb-3 rounded-md border border-amber-300/70 bg-amber-100/70 px-2.5 py-2 text-[11px] text-amber-900">
          <p className="font-semibold">Analyse partielle</p>
          <p>{result.warnings.join(" · ")}</p>
        </div>
      )}

      <AnimatePresence mode="wait">
        {stage === "loading" && (
          <motion.div key="loading" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex flex-col items-center gap-3 py-4">
            <div className="relative w-12 h-12">
              <div className="absolute inset-0 rounded-full border-2 border-muted" />
              <div className="absolute inset-0 rounded-full border-2 border-primary border-t-transparent animate-spin" />
            </div>
            <span className="text-sm text-muted-foreground">Analyse CNN + Satellite + Agro...</span>
            <span className="text-xs text-muted-foreground">S1 + S2 + Score hybride</span>
          </motion.div>
        )}

        {stage === "error" && (
          <motion.div key="error" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col items-center gap-2 py-4">
            <span className="text-destructive text-sm font-medium">Erreur d'analyse</span>
            <span className="text-xs text-muted-foreground text-center">{errorMsg}</span>
          </motion.div>
        )}

        {stage === "percentage" && result && (
          <motion.div key="percentage" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="flex flex-col items-center gap-3 py-2">
            <span className="text-4xl font-bold text-primary mono">{displayPct != null ? `${displayPct}%` : "—"}</span>
            {result.percentage != null && (
              <div className="w-full h-2 rounded-full bg-muted overflow-hidden">
                <motion.div className={`h-full rounded-full ${barColor(result.percentage)}`} initial={{ width: 0 }} animate={{ width: `${result.percentage}%` }} transition={{ duration: 1, ease: "easeOut" }} />
              </div>
            )}
            <span className="text-xs text-muted-foreground">NDVI · Score hybride : {result.hybrid_score ?? "—"}%</span>
          </motion.div>
        )}

        {stage === "verdict" && result && (
          <motion.div key="verdict" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col gap-3 py-2">
            {/* NDVI + Hybrid Score */}
            <div className="flex items-center gap-3">
              <div className="text-center">
                <span className="text-2xl font-bold text-primary mono">{result.percentage != null ? `${result.percentage}%` : "—"}</span>
                <p className="text-[10px] text-muted-foreground">NDVI</p>
              </div>
              {result.percentage != null && (
                <div className="flex-1">
                  <div className="w-full h-2 rounded-full bg-muted overflow-hidden">
                    <div className={`h-full rounded-full ${barColor(result.percentage)}`} style={{ width: `${result.percentage}%` }} />
                  </div>
                </div>
              )}
              {result.hybrid_score != null && (
                <div className="text-center">
                  <span className={`text-2xl font-bold mono ${scoreColor(result.hybrid_score)}`}>{result.hybrid_score}%</span>
                  <p className="text-[10px] text-muted-foreground">Hybride</p>
                </div>
              )}
            </div>

            {/* Verdict */}
            <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.2 }}
              className={`glow-ring rounded-lg px-3 py-2 ${result.is_barley ? "border-vegetation-high/30 bg-vegetation-high/10" : "border-destructive/30 bg-destructive/10"}`}>
              <span className={`text-sm font-semibold ${result.is_barley ? "text-vegetation-high" : "text-destructive"}`}>
                {result.verdict}
              </span>
            </motion.div>

            {/* Score Breakdown */}
            {result.agro_breakdown && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.25 }}
                className="rounded-lg px-3 py-2 bg-muted/50 space-y-1">
                <p className="text-xs font-semibold text-foreground">📊 Décomposition du score</p>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px]">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">CNN</span>
                    <span className="font-mono">{result.cnn_prob_barley?.toFixed(1) ?? "—"}%</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Agro</span>
                    <span className="font-mono">{result.agro_score ?? "—"}%</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">NDVI</span>
                    <span className="font-mono">{result.agro_breakdown.ndvi_score}%</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Cycle</span>
                    <span className="font-mono">{result.agro_breakdown.cycle_score}%</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Radar</span>
                    <span className="font-mono">{result.agro_breakdown.radar_score}%</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Tendance</span>
                    <span className="font-mono">{result.agro_breakdown.ndvi_trend_score}%</span>
                  </div>
                </div>
                <p className="text-[10px] text-muted-foreground italic">= 0.6×CNN + 0.4×Agro</p>
              </motion.div>
            )}

            {/* Spectral Indices */}
            {(result.evi != null || result.savi != null || result.ndwi != null) && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.3 }}
                className="rounded-lg px-3 py-2 bg-muted/50">
                <p className="text-xs font-semibold text-foreground mb-1">🔬 Indices spectraux</p>
                <div className="flex gap-3 text-[11px]">
                  {result.evi != null && <span className="bg-background px-2 py-0.5 rounded">EVI: {result.evi}%</span>}
                  {result.savi != null && <span className="bg-background px-2 py-0.5 rounded">SAVI: {result.savi}%</span>}
                  {result.ndwi != null && <span className="bg-background px-2 py-0.5 rounded">NDWI: {result.ndwi}</span>}
                </div>
              </motion.div>
            )}

            {/* Planting Detection Info */}
            {result.estimated_planting_date && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.35 }}
                className="rounded-lg px-3 py-2 bg-primary/10 border border-primary/20 space-y-1">
                <div className="flex items-center gap-2">
                  <span className="text-lg">{growthStageEmoji(result.growth_stage)}</span>
                  <div>
                    <p className="text-sm font-semibold text-primary">
                      {result.growth_stage} — {result.days_since_planting != null ? `Planté il y a ${result.days_since_planting} jours` : ""}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Semis estimé : {new Date(result.estimated_planting_date).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })}
                      {result.planting_confidence ? ` (confiance ${result.planting_confidence}%)` : ""}
                    </p>
                  </div>
                </div>
                {result.estimated_harvest_date && (
                  <p className="text-xs text-muted-foreground">
                    🗓️ Récolte estimée : {new Date(result.estimated_harvest_date).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })}
                  </p>
                )}
              </motion.div>
            )}

            {/* NDVI Sparkline */}
            {sparklineData.length >= 2 && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.4 }}
                className="rounded-lg p-2 bg-muted/50">
                <p className="text-xs text-muted-foreground mb-1">📈 NDVI 6 mois</p>
                <ResponsiveContainer width="100%" height={50}>
                  <LineChart data={sparklineData}>
                    <YAxis domain={[0, 100]} hide />
                    <Tooltip
                      contentStyle={{ fontSize: 10, backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 6, color: "hsl(var(--foreground))" }}
                      formatter={(v: number) => [`${v.toFixed(1)}%`, "NDVI"]}
                      labelFormatter={(l) => l}
                    />
                    <Line type="monotone" dataKey="ndvi" stroke="hsl(var(--primary))" strokeWidth={2} dot={{ r: 2 }} />
                  </LineChart>
                </ResponsiveContainer>
              </motion.div>
            )}

            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.5 }} className="space-y-2 text-xs">
              <p className="text-muted-foreground leading-relaxed">{result.details}</p>

              {/* CNN + Orge badge */}
              <div className={`rounded-lg px-3 py-2 ${result.is_barley ? "bg-emerald-500/10 border border-emerald-500/20" : "bg-red-500/10 border border-red-500/20"}`}>
                <p className={`text-sm font-bold ${result.is_barley ? "text-emerald-400" : "text-red-400"}`}>
                  {result.is_barley ? "🌾 ORGE" : "❌ NON-ORGE"}
                </p>
                <p className="text-muted-foreground text-xs">
                  CNN : {result.cnn_prob_barley?.toFixed(1) ?? "—"}% orge / {result.cnn_prob_non_barley?.toFixed(1) ?? "—"}% non-orge
                  {result.cnn_available === false && " (indisponible)"}
                </p>
              </div>

              <div className="flex flex-wrap gap-2 pt-1">
                <span className="bg-muted px-2 py-1 rounded-md text-foreground">📅 {result.saison}</span>
                <span className="bg-muted px-2 py-1 rounded-md text-foreground">🎯 {result.confidence}%</span>
              </div>
              {result.soil_type && result.soil_type !== "Non déterminé" && (
                <div className="text-muted-foreground">🏔️ Sol : {result.soil_type}</div>
              )}
              {result.radar_analysis && (
                <div className="text-muted-foreground">📡 Radar : {result.radar_analysis}</div>
              )}
              {result.spectral_analysis && (
                <div className="text-muted-foreground">🔬 Spectral : {result.spectral_analysis}</div>
              )}
              {result.recommendations && (
                <div className="text-primary/80 italic">💡 {result.recommendations}</div>
              )}
              {saved && (
                <div className="text-xs text-accent font-medium pt-1">✅ Sauvegardé en base de données</div>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
