import { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AreaChart, Area, CartesianGrid, XAxis, YAxis, Tooltip, ResponsiveContainer, BarChart, Bar, LineChart, Line, Legend, ComposedChart, PieChart, Pie, Cell, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar } from "recharts";
import { MapPinned, TriangleAlert, CheckCircle2, Search, Wheat, Activity, Map, ArrowLeft, Trash2, Loader2, Bell, History, Leaf, TrendingUp, BarChart3, Droplets, Thermometer, Wind, Calendar, Target, Gauge, Sprout } from "lucide-react";
import { motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { useParcelles, type Parcelle } from "@/hooks/useParcelles";

function statusFromVerdict(verdict: string | null, culture_detected: string | null): string {
  if (!verdict) return "À vérifier";
  const v = verdict.toUpperCase();
  if (v.includes("CONFORME") && !v.includes("NON")) return "Conforme";
  if (v.includes("NON CONFORME")) return "Non conforme";
  if (v.includes("INCERTAIN")) return "Incertain";
  if (culture_detected && culture_detected.toLowerCase().includes("orge")) return "Conforme";
  return "Non conforme";
}

function statusBadgeClass(status: string): string {
  if (status === "Conforme") return "bg-emerald-100 text-emerald-700 border-emerald-200";
  if (status === "Non conforme") return "bg-red-100 text-red-700 border-red-200";
  if (status === "Incertain") return "bg-amber-100 text-amber-700 border-amber-200";
  return "bg-gray-100 text-gray-700 border-gray-200";
}

function average(values: Array<number | null>): number | null {
  const available = values.filter((value): value is number => value != null);
  return available.length > 0 ? Math.round(available.reduce((sum, value) => sum + value, 0) / available.length) : null;
}

function minimum(values: Array<{ value: number }>): number | null {
  return values.length > 0 ? Math.min(...values.map((item) => item.value)) : null;
}

function maximum(values: Array<{ value: number }>): number | null {
  return values.length > 0 ? Math.max(...values.map((item) => item.value)) : null;
}

export default function Dashboard() {
  const navigate = useNavigate();
  const { parcelles, loading, deleteParcelle } = useParcelles();
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [indicesView, setIndicesView] = useState<"comparison" | "separate">("separate");

  const enriched = useMemo(() =>
    parcelles.map((a) => ({
      ...a,
      status: statusFromVerdict(a.verdict, a.culture_detected),
      evi_display: a.evi,
      savi_display: a.savi,
      ndwi_display: a.ndwi,
      agro_score_display: a.agro_score,
      hybrid_score_display: a.hybrid_score,
    })), [parcelles]);

  const filtered = useMemo(() => {
    return enriched.filter((p) => {
      const q = query.toLowerCase();
      const matchQuery = !q || p.id.toLowerCase().includes(q) || (p.culture_detected || "").toLowerCase().includes(q) || (p.owner_name || "").toLowerCase().includes(q) || p.center_lat.toFixed(2).includes(q) || p.center_lng.toFixed(2).includes(q);
      const matchStatus = statusFilter === "all" || p.status === statusFilter;
      return matchQuery && matchStatus;
    });
  }, [enriched, query, statusFilter]);

  const selected = filtered.find((p) => p.id === selectedId) || filtered[0] || null;

  const totalParcels = enriched.length;
  const conformes = enriched.filter((p) => p.status === "Conforme").length;
  const nonConformes = enriched.filter((p) => p.status === "Non conforme").length;
  const incertains = enriched.filter((p) => p.status === "Incertain").length;
  const avgNdvi = average(enriched.map((p) => p.ndvi_percentage));
  const avgEvi = average(enriched.map((p) => p.evi_display));
  const avgSavi = average(enriched.map((p) => p.savi_display));
  const avgAgroScore = average(enriched.map((p) => p.agro_score_display));
  const avgHybridScore = average(enriched.map((p) => p.hybrid_score_display));

  // Anomalies (non-conforme or incertain)
  const anomalies = useMemo(() => enriched.filter((p) => p.status !== "Conforme"), [enriched]);

  // Culture history distribution
  const cultureDistribution = useMemo(() => {
    const map: Record<string, number> = {};
    enriched.forEach((a) => {
      const key = a.culture_detected || "Inconnu";
      map[key] = (map[key] || 0) + 1;
    });
    return Object.entries(map).map(([name, value]) => ({ name, value }));
  }, [enriched]);

  // Vegetation indices chart data
  const indicesData = useMemo(() =>
    enriched.map((a) => ({
      name: a.owner_name || a.id.slice(0, 8),
      NDVI: a.ndvi_percentage,
      EVI: a.evi_display,
      SAVI: a.savi_display,
      Confiance: a.confidence,
    })), [enriched]);

  // Separate data for individual index charts
  const ndviOnlyData = useMemo(() =>
    indicesData.flatMap(d => d.NDVI == null ? [] : [{ name: d.name, value: d.NDVI }]), [indicesData]);

  const eviOnlyData = useMemo(() =>
    indicesData.flatMap(d => d.EVI == null ? [] : [{ name: d.name, value: d.EVI }]), [indicesData]);

  const saviOnlyData = useMemo(() =>
    indicesData.flatMap(d => d.SAVI == null ? [] : [{ name: d.name, value: d.SAVI }]), [indicesData]);

  // Health metrics data
  const healthData = useMemo(() =>
    enriched.map((a) => ({
      name: a.owner_name || a.id.slice(0, 8),
      "Score Agro": a.agro_score_display,
      "Score Hybride": a.hybrid_score_display,
      NDVI: a.ndvi_percentage,
    })), [enriched]);

  // Pie chart colors
  const PIE_COLORS = ["#10b981", "#ef4444", "#f59e0b", "#6b7280"];

  // Radar chart data for selected parcel
  const radarData = useMemo(() => {
    if (!selected) return [];
    return [
      { subject: "NDVI", value: selected.ndvi_percentage, fullMark: 100 },
      { subject: "EVI", value: selected.evi_display, fullMark: 100 },
      { subject: "SAVI", value: selected.savi_display, fullMark: 100 },
      { subject: "Agro", value: selected.agro_score_display, fullMark: 100 },
      { subject: "Hybride", value: selected.hybrid_score_display, fullMark: 100 },
      { subject: "Confiance", value: selected.confidence, fullMark: 100 },
    ];
  }, [selected]);

  // Culture history by date
  const cultureHistory = useMemo(() => {
    const sorted = [...enriched].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
    return sorted.map((p) => ({
      date: new Date(p.created_at).toLocaleDateString("fr-FR", { day: "2-digit", month: "short" }),
      culture: p.culture_detected || "Inconnu",
      ndvi: p.ndvi_percentage,
      owner: p.owner_name || "—",
    }));
  }, [enriched]);

  const handleDelete = async (id: string) => {
    setDeleting(id);
    await deleteParcelle(id);
    setDeleting(null);
    if (selectedId === id) setSelectedId(null);
  };

  const kpis = [
    { label: "Parcelles analysées", value: totalParcels, icon: MapPinned, helper: "Total des analyses", color: "bg-emerald-100 text-emerald-600" },
    { label: "NDVI moyen", value: avgNdvi != null ? `${avgNdvi}%` : "—", icon: Leaf, helper: "Indice de végétation", color: "bg-green-100 text-green-600" },
    { label: "Score hybride", value: avgHybridScore != null ? `${avgHybridScore}%` : "—", icon: Target, helper: "CNN + Agro combinés", color: "bg-blue-100 text-blue-600" },
    { label: "Conformité orge", value: totalParcels > 0 ? `${((conformes / totalParcels) * 100).toFixed(1)}%` : "—", icon: CheckCircle2, helper: `${conformes} parcelle(s) d'orge`, color: "bg-emerald-100 text-emerald-600" },
  ];

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-emerald-600 animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 text-gray-900">
      {/* Header */}
      <div className="border-b border-gray-200 bg-white/80 backdrop-blur-sm sticky top-0 z-50 shadow-sm">
        <div className="max-w-[1600px] mx-auto px-6 py-5 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="sm" onClick={() => navigate("/")} className="gap-2 text-gray-600 hover:text-gray-900 hover:bg-gray-100">
              <ArrowLeft className="w-4 h-4" />
              Carte
            </Button>
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Malto — Détection Orge</h1>
              <p className="text-sm text-gray-500">Suivi satellite · NDVI · EVI · Alertes anomalies</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-xs text-gray-500 font-mono">IA Gemini + GEE</span>
          </div>
        </div>
      </div>

      <div className="max-w-[1600px] mx-auto px-6 py-8 space-y-8">
        {/* KPIs */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
          {kpis.map((item) => {
            const Icon = item.icon;
            return (
              <motion.div key={item.label} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
                <Card className="bg-white border-gray-200 shadow-sm hover:shadow-md transition-shadow">
                  <CardContent className="p-5">
                    <div className="flex items-center gap-4">
                      <div className={`p-3 rounded-xl ${item.color}`}>
                        <Icon className="w-6 h-6" />
                      </div>
                      <div>
                        <p className="text-sm text-gray-500">{item.label}</p>
                        <p className="text-3xl font-bold text-gray-900">{item.value}</p>
                        <p className="text-xs text-gray-400">{item.helper}</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            );
          })}
        </div>

        {/* Additional Metrics Row */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <Card className="bg-white border-gray-200">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-gray-500">EVI Moyen</p>
                  <p className="text-2xl font-bold text-gray-900">{avgEvi != null ? `${avgEvi}%` : "—"}</p>
                </div>
                <TrendingUp className="w-8 h-8 text-green-500 opacity-50" />
              </div>
            </CardContent>
          </Card>
          <Card className="bg-white border-gray-200">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-gray-500">SAVI Moyen</p>
                  <p className="text-2xl font-bold text-gray-900">{avgSavi != null ? `${avgSavi}%` : "—"}</p>
                </div>
                <Target className="w-8 h-8 text-amber-500 opacity-50" />
              </div>
            </CardContent>
          </Card>
          <Card className="bg-white border-gray-200">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-gray-500">Score Agro moyen</p>
                  <p className="text-2xl font-bold text-gray-900">{avgAgroScore != null ? `${avgAgroScore}%` : "—"}</p>
                </div>
                <Gauge className="w-8 h-8 text-orange-500 opacity-50" />
              </div>
            </CardContent>
          </Card>
          <Card className="bg-white border-gray-200">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-gray-500">Alertes actives</p>
                  <p className="text-2xl font-bold text-gray-900">{nonConformes + incertains}</p>
                </div>
                <Bell className="w-8 h-8 text-red-500 opacity-50" />
              </div>
            </CardContent>
          </Card>
        </div>

        {totalParcels === 0 ? (
          <Card className="bg-white border-gray-200">
            <CardContent className="p-12 text-center">
              <Map className="w-12 h-12 text-gray-400 mx-auto mb-4" />
              <h2 className="text-xl font-semibold text-gray-900 mb-2">Aucune analyse effectuée</h2>
              <p className="text-gray-500 mb-4">Retournez à la carte pour tracer des parcelles ou entrer des coordonnées GPS.</p>
              <Button onClick={() => navigate("/")} className="gap-2 bg-emerald-600 hover:bg-emerald-700">
                <Map className="w-4 h-4" />
                Aller à la carte
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="grid lg:grid-cols-3 gap-6">
            {/* Left: selected detail */}
            <div className="space-y-5">
              {selected && (
                <>
                  <Card className="bg-white border-gray-200 shadow-sm">
                    <CardHeader className="pb-3 border-b border-gray-100">
                      <div className="flex items-center justify-between">
                        <CardTitle className="text-base flex items-center gap-2 font-semibold text-gray-900">
                          <Wheat className="w-5 h-5 text-emerald-600" />
                          Parcelle sélectionnée
                        </CardTitle>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDelete(selected.id)}
                          disabled={deleting === selected.id}
                          className="text-red-500 hover:text-red-700 hover:bg-red-50 h-8 w-8 p-0"
                        >
                          {deleting === selected.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                        </Button>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-5 pt-5">
                      <div>
                        <p className="text-xl font-bold text-gray-900">{selected.owner_name || selected.id.slice(0, 8)}</p>
                        <p className="text-sm text-gray-500 font-mono">{selected.center_lat.toFixed(5)}, {selected.center_lng.toFixed(5)}</p>
                        {selected.surface_ha && <p className="text-sm text-gray-500">{selected.surface_ha} ha</p>}
                        {selected.notes && (
                          <p className="text-sm text-amber-600 mt-2">📝 {selected.notes}</p>
                        )}
                      </div>

                      <div className="grid grid-cols-2 gap-4 text-sm">
                        <div className="bg-gray-50 rounded-lg p-3">
                          <p className="text-xs text-gray-500">Culture (CNN)</p>
                          <p className={`font-semibold text-base ${selected.culture_detected?.toLowerCase().includes("orge") && !selected.culture_detected?.toLowerCase().includes("non") ? "text-emerald-700" : "text-red-700"}`}>
                            {selected.culture_detected?.toLowerCase().includes("orge") && !selected.culture_detected?.toLowerCase().includes("non") ? "🌾 Orge" : "❌ Non-orge"}
                          </p>
                        </div>
                        <div className="bg-gray-50 rounded-lg p-3">
                          <p className="text-xs text-gray-500">Culture déclarée</p>
                          <p className="font-semibold text-gray-900 text-base">{selected.culture_declared || "—"}</p>
                        </div>
                        <div className="bg-gray-50 rounded-lg p-3">
                          <p className="text-xs text-gray-500">NDVI</p>
                          <p className="font-semibold text-gray-900 text-lg">{selected.ndvi_percentage != null ? `${selected.ndvi_percentage}%` : "—"}</p>
                        </div>
                        <div className="bg-gray-50 rounded-lg p-3">
                          <p className="text-xs text-gray-500">EVI</p>
                          <p className="font-semibold text-gray-900 text-lg">{selected.evi != null ? `${selected.evi}%` : "—"}</p>
                        </div>
                        <div className="bg-gray-50 rounded-lg p-3">
                          <p className="text-xs text-gray-500">SAVI</p>
                          <p className="font-semibold text-gray-900 text-lg">{selected.savi != null ? `${selected.savi}%` : "—"}</p>
                        </div>
                        <div className="bg-gray-50 rounded-lg p-3">
                          <p className="text-xs text-gray-500">Score Agro</p>
                          <p className="font-semibold text-gray-900 text-lg">{selected.agro_score_display != null ? `${selected.agro_score_display}%` : "—"}</p>
                        </div>
                      </div>

                      <div>
                        <div className="flex justify-between text-sm mb-2">
                          <span className="text-gray-600">Confiance du modèle</span>
                          <span className="text-gray-900 font-semibold">{selected.confidence != null ? `${selected.confidence}%` : "—"}</span>
                        </div>
                        <Progress value={selected.confidence ?? undefined} className="h-2 bg-gray-200" />
                      </div>

                      {selected.status === "Non conforme" && (
                        <Alert className="border-red-200 bg-red-50">
                          <TriangleAlert className="h-4 w-4 text-red-600" />
                          <AlertTitle className="text-sm font-semibold text-red-800">🚨 NON CONFORME — Pas d'orge détectée</AlertTitle>
                          <AlertDescription className="text-xs text-red-700">
                            Culture déclarée : Orge — Culture détectée : {selected.culture_detected}. Contrôle terrain recommandé.
                          </AlertDescription>
                        </Alert>
                      )}
                      {selected.status === "Incertain" && (
                        <Alert className="border-amber-200 bg-amber-50">
                          <TriangleAlert className="h-4 w-4 text-amber-600" />
                          <AlertTitle className="text-sm font-semibold text-amber-800">⚠️ INCERTAIN — Vérification nécessaire</AlertTitle>
                          <AlertDescription className="text-xs text-amber-700">
                            Classification insuffisante. Contrôle terrain à planifier.
                          </AlertDescription>
                        </Alert>
                      )}
                      {selected.status === "Conforme" && (
                        <Alert className="border-emerald-200 bg-emerald-50">
                          <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                          <AlertTitle className="text-sm font-semibold text-emerald-800">✅ CONFORME — Orge détectée</AlertTitle>
                          <AlertDescription className="text-xs text-emerald-700">
                            Parcelle conforme, culture d'orge confirmée (confiance : {selected.confidence}%).
                          </AlertDescription>
                        </Alert>
                      )}

                      <div className="flex flex-wrap gap-2">
                        <Badge className={statusBadgeClass(selected.status)}>{selected.status}</Badge>
                        {selected.culture_detected && <Badge variant="outline" className="border-gray-300 text-gray-700">{selected.culture_detected}</Badge>}
                      </div>

                      {selected.risk_factors.length > 0 && (
                        <Alert className="border-gray-200 bg-gray-50">
                          <TriangleAlert className="h-4 w-4 text-gray-600" />
                          <AlertTitle className="text-sm">Facteurs de risque</AlertTitle>
                          <AlertDescription className="text-xs">{selected.risk_factors.join(" · ")}</AlertDescription>
                        </Alert>
                      )}

                      {selected.recommendations && (
                        <div className="text-sm text-emerald-700 italic bg-emerald-50 rounded-lg p-3">
                          💡 {selected.recommendations}
                        </div>
                      )}
                    </CardContent>
                  </Card>

                  {/* Radar Chart for Selected Parcel */}
                  <Card className="bg-white border-gray-200 shadow-sm">
                    <CardHeader className="pb-2 border-b border-gray-100">
                      <CardTitle className="text-base flex items-center gap-2 font-semibold text-gray-900">
                        <Gauge className="w-4 h-4 text-emerald-600" />
                        Analyse multicritère
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="pt-5">
                      <ResponsiveContainer width="100%" height={280}>
                        <RadarChart cx="50%" cy="50%" outerRadius="80%" data={radarData}>
                          <PolarGrid stroke="#e5e7eb" />
                          <PolarAngleAxis dataKey="subject" tick={{ fill: "#6b7280", fontSize: 11 }} />
                          <PolarRadiusAxis angle={30} domain={[0, 100]} tick={{ fill: "#9ca3af", fontSize: 10 }} />
                          <Radar name="Valeur" dataKey="value" stroke="#10b981" fill="#10b981" fillOpacity={0.3} />
                          <Tooltip contentStyle={{ backgroundColor: "white", border: "1px solid #e5e7eb", borderRadius: 8, color: "#111827" }} />
                        </RadarChart>
                      </ResponsiveContainer>
                    </CardContent>
                  </Card>
                </>
              )}
            </div>

            {/* Right: table + charts */}
            <div className="lg:col-span-2 space-y-5">
              <Tabs defaultValue="table" className="space-y-5">
                <TabsList className="bg-gray-100 p-1 rounded-lg">
                  <TabsTrigger value="table" className="text-sm data-[state=active]:bg-white data-[state=active:text-gray-900">Registre</TabsTrigger>
                  <TabsTrigger value="indices" className="text-sm data-[state=active]:bg-white data-[state=active:text-gray-900">Indices végétaux</TabsTrigger>
                  <TabsTrigger value="health" className="text-sm data-[state=active]:bg-white data-[state=active:text-gray-900">Santé des cultures</TabsTrigger>
                  <TabsTrigger value="alerts" className="text-sm data-[state=active]:bg-white data-[state=active:text-gray-900">Alertes</TabsTrigger>
                  <TabsTrigger value="phenology" className="text-sm data-[state=active]:bg-white data-[state=active:text-gray-900">Phénologie</TabsTrigger>
                  <TabsTrigger value="history" className="text-sm data-[state=active]:bg-white data-[state=active:text-gray-900">Historique</TabsTrigger>
                </TabsList>

                <TabsContent value="table" className="space-y-4">
                  <div className="flex flex-wrap gap-3">
                    <div className="relative flex-1 min-w-[200px]">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                      <Input 
                        value={query} 
                        onChange={(e) => setQuery(e.target.value)} 
                        placeholder="Rechercher propriétaire, culture..." 
                        className="pl-10 bg-white border-gray-200 text-gray-900 placeholder:text-gray-400" 
                      />
                    </div>
                    <Select value={statusFilter} onValueChange={setStatusFilter}>
                      <SelectTrigger className="w-[180px] bg-white border-gray-200">
                        <SelectValue placeholder="Statut" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">Tous les statuts</SelectItem>
                        <SelectItem value="Conforme">Conforme (Orge)</SelectItem>
                        <SelectItem value="Non conforme">Non conforme</SelectItem>
                        <SelectItem value="Incertain">Incertain</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <Card className="bg-white border-gray-200 overflow-hidden shadow-sm">
                    <Table>
                      <TableHeader className="bg-gray-50">
                        <TableRow className="border-gray-200">
                          <TableHead className="text-gray-700 font-semibold">Propriétaire</TableHead>
                          <TableHead className="text-gray-700 font-semibold">Coordonnées</TableHead>
                          <TableHead className="text-gray-700 font-semibold">Culture (CNN)</TableHead>
                          <TableHead className="text-gray-700 font-semibold">NDVI</TableHead>
                          <TableHead className="text-gray-700 font-semibold">EVI</TableHead>
                          <TableHead className="text-gray-700 font-semibold">Statut</TableHead>
                          <TableHead></TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filtered.map((row) => (
                          <TableRow key={row.id} onClick={() => setSelectedId(row.id)} className="cursor-pointer border-gray-100 hover:bg-gray-50">
                            <TableCell className="font-medium text-gray-900">{row.owner_name || row.id.slice(0, 8)}</TableCell>
                            <TableCell className="text-sm font-mono text-gray-500">{row.center_lat.toFixed(3)}, {row.center_lng.toFixed(3)}</TableCell>
                            <TableCell>
                              <Badge className={row.culture_detected?.toLowerCase().includes("orge") && !row.culture_detected?.toLowerCase().includes("non") ? "bg-emerald-100 text-emerald-700 border-emerald-200" : "bg-red-100 text-red-700 border-red-200"}>
                                {row.culture_detected?.toLowerCase().includes("orge") && !row.culture_detected?.toLowerCase().includes("non") ? "🌾 Orge" : "❌ Non-orge"}
                              </Badge>
                            </TableCell>
                            <TableCell className="font-semibold text-gray-900">{row.ndvi_percentage != null ? `${row.ndvi_percentage}%` : "—"}</TableCell>
                            <TableCell className="text-gray-700">{row.evi != null ? `${row.evi}%` : "—"}</TableCell>
                            <TableCell>
                              <Badge className={statusBadgeClass(row.status)}>{row.status}</Badge>
                            </TableCell>
                            <TableCell>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={(e) => { e.stopPropagation(); handleDelete(row.id); }}
                                disabled={deleting === row.id}
                                className="text-red-400 hover:text-red-600 hover:bg-red-50 h-8 w-8 p-0"
                              >
                                {deleting === row.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))}
                        {filtered.length === 0 && (
                          <TableRow>
                            <TableCell colSpan={7} className="text-center text-gray-500 py-8">Aucun résultat</TableCell>
                          </TableRow>
                        )}
                      </TableBody>
                    </Table>
                  </Card>
                </TabsContent>

                {/* Vegetation Indices Tab - Separated View */}
                <TabsContent value="indices" className="space-y-5">
                  {/* View Toggle */}
                  <div className="flex justify-end">
                    <div className="flex gap-2 bg-gray-100 rounded-lg p-1">
                      <Button
                        variant={indicesView === "comparison" ? "default" : "ghost"}
                        size="sm"
                        onClick={() => setIndicesView("comparison")}
                        className={`gap-2 h-8 ${indicesView === "comparison" ? "bg-emerald-600 hover:bg-emerald-700" : "text-gray-600"}`}
                      >
                        <TrendingUp className="w-3 h-3" />
                        Comparaison
                      </Button>
                      <Button
                        variant={indicesView === "separate" ? "default" : "ghost"}
                        size="sm"
                        onClick={() => setIndicesView("separate")}
                        className={`gap-2 h-8 ${indicesView === "separate" ? "bg-emerald-600 hover:bg-emerald-700" : "text-gray-600"}`}
                      >
                        <BarChart3 className="w-3 h-3" />
                        Vue séparée
                      </Button>
                    </div>
                  </div>

                  {indicesView === "comparison" ? (
                    <Card className="bg-white border-gray-200 shadow-sm">
                      <CardHeader className="pb-2 border-b border-gray-100">
                        <CardTitle className="text-base flex items-center gap-2 font-semibold text-gray-900">
                          <Leaf className="w-4 h-4 text-emerald-600" />
                          Comparaison des indices de végétation
                        </CardTitle>
                        <p className="text-sm text-gray-500">Vue d'ensemble comparative des trois indices</p>
                      </CardHeader>
                      <CardContent className="pt-5">
                        <ResponsiveContainer width="100%" height={380}>
                          <LineChart data={indicesData}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                            <XAxis dataKey="name" tick={{ fill: "#6b7280", fontSize: 12 }} angle={-45} textAnchor="end" height={70} />
                            <YAxis tick={{ fill: "#6b7280", fontSize: 12 }} domain={[0, 100]} />
                            <Tooltip contentStyle={{ backgroundColor: "white", border: "1px solid #e5e7eb", borderRadius: 8, color: "#111827" }} />
                            <Legend wrapperStyle={{ paddingTop: 20 }} />
                            <Line type="monotone" dataKey="NDVI" stroke="#10b981" strokeWidth={2} dot={{ r: 4 }} name="NDVI" />
                            <Line type="monotone" dataKey="EVI" stroke="#84cc16" strokeWidth={2} dot={{ r: 4 }} name="EVI" />
                            <Line type="monotone" dataKey="SAVI" stroke="#f59e0b" strokeWidth={2} dot={{ r: 4 }} name="SAVI" />
                          </LineChart>
                        </ResponsiveContainer>
                      </CardContent>
                    </Card>
                  ) : (
                    <div className="space-y-5">
                      {/* NDVI Chart */}
                      <Card className="bg-white border-gray-200 shadow-sm">
                        <CardHeader className="pb-2 border-b border-gray-100">
                          <CardTitle className="text-base flex items-center gap-2 font-semibold text-gray-900">
                            <div className="w-3 h-3 rounded-full bg-emerald-500" />
                            <span>NDVI (Normalized Difference Vegetation Index)</span>
                          </CardTitle>
                          <p className="text-sm text-gray-500">Indice de végétation standard - valeurs élevées = végétation dense et saine</p>
                        </CardHeader>
                        <CardContent className="pt-5">
                          <ResponsiveContainer width="100%" height={300}>
                            <BarChart data={ndviOnlyData}>
                              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                              <XAxis dataKey="name" tick={{ fill: "#6b7280", fontSize: 12 }} angle={-45} textAnchor="end" height={70} />
                              <YAxis tick={{ fill: "#6b7280", fontSize: 12 }} domain={[0, 100]} />
                              <Tooltip contentStyle={{ backgroundColor: "white", border: "1px solid #e5e7eb", borderRadius: 8, color: "#111827" }} />
                              <Bar dataKey="value" fill="#10b981" radius={[4, 4, 0, 0]} name="NDVI" />
                            </BarChart>
                          </ResponsiveContainer>
                          <div className="mt-4 grid grid-cols-3 gap-4 text-center">
                            <div className="p-3 bg-gray-50 rounded-lg">
                              <p className="text-sm text-gray-500">Moyenne</p>
                              <p className="text-2xl font-bold text-gray-900">{avgNdvi != null ? `${avgNdvi}%` : "—"}</p>
                            </div>
                            <div className="p-3 bg-gray-50 rounded-lg">
                              <p className="text-sm text-gray-500">Minimum</p>
                              <p className="text-2xl font-bold text-gray-900">{minimum(ndviOnlyData) != null ? `${minimum(ndviOnlyData)}%` : "—"}</p>
                            </div>
                            <div className="p-3 bg-gray-50 rounded-lg">
                              <p className="text-sm text-gray-500">Maximum</p>
                              <p className="text-2xl font-bold text-gray-900">{maximum(ndviOnlyData) != null ? `${maximum(ndviOnlyData)}%` : "—"}</p>
                            </div>
                          </div>
                        </CardContent>
                      </Card>

                      {/* EVI Chart */}
                      <Card className="bg-white border-gray-200 shadow-sm">
                        <CardHeader className="pb-2 border-b border-gray-100">
                          <CardTitle className="text-base flex items-center gap-2 font-semibold text-gray-900">
                            <div className="w-3 h-3 rounded-full bg-lime-500" />
                            <span>EVI (Enhanced Vegetation Index)</span>
                          </CardTitle>
                          <p className="text-sm text-gray-500">Indice amélioré - moins sensible aux variations atmosphériques et au sol</p>
                        </CardHeader>
                        <CardContent className="pt-5">
                          <ResponsiveContainer width="100%" height={300}>
                            <BarChart data={eviOnlyData}>
                              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                              <XAxis dataKey="name" tick={{ fill: "#6b7280", fontSize: 12 }} angle={-45} textAnchor="end" height={70} />
                              <YAxis tick={{ fill: "#6b7280", fontSize: 12 }} domain={[0, 100]} />
                              <Tooltip contentStyle={{ backgroundColor: "white", border: "1px solid #e5e7eb", borderRadius: 8, color: "#111827" }} />
                              <Bar dataKey="value" fill="#84cc16" radius={[4, 4, 0, 0]} name="EVI" />
                            </BarChart>
                          </ResponsiveContainer>
                          <div className="mt-4 grid grid-cols-3 gap-4 text-center">
                            <div className="p-3 bg-gray-50 rounded-lg">
                              <p className="text-sm text-gray-500">Moyenne</p>
                              <p className="text-2xl font-bold text-gray-900">{avgEvi != null ? `${avgEvi}%` : "—"}</p>
                            </div>
                            <div className="p-3 bg-gray-50 rounded-lg">
                              <p className="text-sm text-gray-500">Minimum</p>
                              <p className="text-2xl font-bold text-gray-900">{minimum(eviOnlyData) != null ? `${minimum(eviOnlyData)}%` : "—"}</p>
                            </div>
                            <div className="p-3 bg-gray-50 rounded-lg">
                              <p className="text-sm text-gray-500">Maximum</p>
                              <p className="text-2xl font-bold text-gray-900">{maximum(eviOnlyData) != null ? `${maximum(eviOnlyData)}%` : "—"}</p>
                            </div>
                          </div>
                        </CardContent>
                      </Card>

                      {/* SAVI Chart */}
                      <Card className="bg-white border-gray-200 shadow-sm">
                        <CardHeader className="pb-2 border-b border-gray-100">
                          <CardTitle className="text-base flex items-center gap-2 font-semibold text-gray-900">
                            <div className="w-3 h-3 rounded-full bg-amber-500" />
                            <span>SAVI (Soil Adjusted Vegetation Index)</span>
                          </CardTitle>
                          <p className="text-sm text-gray-500">Indice corrigé pour les sols nus - optimisé pour zones arides</p>
                        </CardHeader>
                        <CardContent className="pt-5">
                          <ResponsiveContainer width="100%" height={300}>
                            <BarChart data={saviOnlyData}>
                              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                              <XAxis dataKey="name" tick={{ fill: "#6b7280", fontSize: 12 }} angle={-45} textAnchor="end" height={70} />
                              <YAxis tick={{ fill: "#6b7280", fontSize: 12 }} domain={[0, 100]} />
                              <Tooltip contentStyle={{ backgroundColor: "white", border: "1px solid #e5e7eb", borderRadius: 8, color: "#111827" }} />
                              <Bar dataKey="value" fill="#f59e0b" radius={[4, 4, 0, 0]} name="SAVI" />
                            </BarChart>
                          </ResponsiveContainer>
                          <div className="mt-4 grid grid-cols-3 gap-4 text-center">
                            <div className="p-3 bg-gray-50 rounded-lg">
                              <p className="text-sm text-gray-500">Moyenne</p>
                              <p className="text-2xl font-bold text-gray-900">{avgSavi != null ? `${avgSavi}%` : "—"}</p>
                            </div>
                            <div className="p-3 bg-gray-50 rounded-lg">
                              <p className="text-sm text-gray-500">Minimum</p>
                              <p className="text-2xl font-bold text-gray-900">{minimum(saviOnlyData) != null ? `${minimum(saviOnlyData)}%` : "—"}</p>
                            </div>
                            <div className="p-3 bg-gray-50 rounded-lg">
                              <p className="text-sm text-gray-500">Maximum</p>
                              <p className="text-2xl font-bold text-gray-900">{maximum(saviOnlyData) != null ? `${maximum(saviOnlyData)}%` : "—"}</p>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    </div>
                  )}

                  {/* Culture Distribution */}
                  {cultureDistribution.length > 0 && (
                    <Card className="bg-white border-gray-200 shadow-sm">
                      <CardHeader className="pb-2 border-b border-gray-100">
                        <CardTitle className="text-base flex items-center gap-2 font-semibold text-gray-900">
                          <Wheat className="w-4 h-4 text-emerald-600" />
                          Répartition des cultures détectées
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="pt-5">
                        <div className="grid md:grid-cols-2 gap-6">
                          <ResponsiveContainer width="100%" height={250}>
                            <BarChart data={cultureDistribution}>
                              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                              <XAxis dataKey="name" tick={{ fill: "#6b7280", fontSize: 12 }} />
                              <YAxis tick={{ fill: "#6b7280", fontSize: 12 }} />
                              <Tooltip contentStyle={{ backgroundColor: "white", border: "1px solid #e5e7eb", borderRadius: 8, color: "#111827" }} />
                              <Bar dataKey="value" fill="#10b981" radius={[4, 4, 0, 0]} />
                            </BarChart>
                          </ResponsiveContainer>
                          <ResponsiveContainer width="100%" height={250}>
                            <PieChart>
                              <Pie
                                data={cultureDistribution}
                                cx="50%"
                                cy="50%"
                                labelLine={false}
                                label={({ name, percent }) => `${name}: ${(percent * 100).toFixed(0)}%`}
                                outerRadius={80}
                                fill="#8884d8"
                                dataKey="value"
                              >
                                {cultureDistribution.map((entry, index) => (
                                  <Cell key={`cell-${index}`} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                                ))}
                              </Pie>
                              <Tooltip contentStyle={{ backgroundColor: "white", border: "1px solid #e5e7eb", borderRadius: 8, color: "#111827" }} />
                            </PieChart>
                          </ResponsiveContainer>
                        </div>
                      </CardContent>
                    </Card>
                  )}
                </TabsContent>

                {/* Health Metrics Tab */}
                <TabsContent value="health" className="space-y-5">
                  <Card className="bg-white border-gray-200 shadow-sm">
                    <CardHeader className="pb-2 border-b border-gray-100">
                      <CardTitle className="text-base flex items-center gap-2 font-semibold text-gray-900">
                        <Gauge className="w-4 h-4 text-blue-600" />
                        Scores CNN + Agro par parcelle
                      </CardTitle>
                      <p className="text-sm text-gray-500">Score agronomique et hybride (0.6×CNN + 0.4×Agro)</p>
                    </CardHeader>
                    <CardContent className="pt-5">
                      <ResponsiveContainer width="100%" height={350}>
                        <LineChart data={healthData}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                          <XAxis dataKey="name" tick={{ fill: "#6b7280", fontSize: 12 }} angle={-45} textAnchor="end" height={70} />
                          <YAxis tick={{ fill: "#6b7280", fontSize: 12 }} domain={[0, 100]} />
                          <Tooltip contentStyle={{ backgroundColor: "white", border: "1px solid #e5e7eb", borderRadius: 8, color: "#111827" }} />
                          <Legend wrapperStyle={{ paddingTop: 20 }} />
                          <Line type="monotone" dataKey="Score Agro" stroke="#3b82f6" strokeWidth={2} dot={{ r: 4 }} name="Score Agro (%)" />
                          <Line type="monotone" dataKey="Score Hybride" stroke="#10b981" strokeWidth={2} dot={{ r: 4 }} name="Score Hybride (%)" />
                        </LineChart>
                      </ResponsiveContainer>
                    </CardContent>
                  </Card>

                  <div className="grid md:grid-cols-2 gap-5">
                    <Card className="bg-white border-gray-200 shadow-sm">
                      <CardHeader className="pb-2 border-b border-gray-100">
                        <CardTitle className="text-base flex items-center gap-2 font-semibold text-gray-900">
                          <Gauge className="w-4 h-4 text-blue-600" />
                          Score Agro moyen
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="pt-5 text-center">
                        <p className="text-5xl font-bold text-blue-600">{avgAgroScore != null ? `${avgAgroScore}%` : "—"}</p>
                        <p className="text-sm text-gray-500 mt-2">Règles agronomiques</p>
                        <Progress value={avgAgroScore ?? undefined} className="h-2 mt-4 bg-gray-200" />
                        <p className="text-xs text-gray-400 mt-2">NDVI + Cycle + Radar + Tendance</p>
                      </CardContent>
                    </Card>

                    <Card className="bg-white border-gray-200 shadow-sm">
                      <CardHeader className="pb-2 border-b border-gray-100">
                        <CardTitle className="text-base flex items-center gap-2 font-semibold text-gray-900">
                          <Target className="w-4 h-4 text-emerald-600" />
                          Score Hybride moyen
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="pt-5 text-center">
                        <p className="text-5xl font-bold text-emerald-600">{avgHybridScore != null ? `${avgHybridScore}%` : "—"}</p>
                        <p className="text-sm text-gray-500 mt-2">0.6×CNN + 0.4×Agro</p>
                        <Progress value={avgHybridScore ?? undefined} className="h-2 mt-4 bg-gray-200" />
                        <p className="text-xs text-gray-400 mt-2">Score final combiné</p>
                      </CardContent>
                    </Card>
                  </div>

                  <Card className="bg-white border-gray-200 shadow-sm">
                    <CardHeader className="pb-2 border-b border-gray-100">
                      <CardTitle className="text-base flex items-center gap-2 font-semibold text-gray-900">
                        <Activity className="w-4 h-4 text-emerald-600" />
                        NDVI vs Score Hybride
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="pt-5">
                      <ResponsiveContainer width="100%" height={300}>
                        <BarChart data={healthData}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                          <XAxis dataKey="name" tick={{ fill: "#6b7280", fontSize: 12 }} angle={-45} textAnchor="end" height={70} />
                          <YAxis tick={{ fill: "#6b7280", fontSize: 12 }} domain={[0, 100]} />
                          <Tooltip contentStyle={{ backgroundColor: "white", border: "1px solid #e5e7eb", borderRadius: 8, color: "#111827" }} />
                          <Legend wrapperStyle={{ paddingTop: 20 }} />
                          <Bar dataKey="NDVI" fill="#10b981" name="NDVI (%)" radius={[4, 4, 0, 0]} />
                          <Bar dataKey="Score Hybride" fill="#3b82f6" name="Score Hybride (%)" radius={[4, 4, 0, 0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    </CardContent>
                  </Card>
                </TabsContent>

                {/* Anomaly Alerts Tab */}
                <TabsContent value="alerts">
                  <Card className="bg-white border-gray-200 shadow-sm">
                    <CardHeader className="pb-2 border-b border-gray-100">
                      <CardTitle className="text-base flex items-center gap-2 font-semibold text-gray-900">
                        <Bell className="w-4 h-4 text-red-600" />
                        Alertes et anomalies ({anomalies.length})
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3 pt-5">
                      {anomalies.length === 0 ? (
                        <div className="text-center py-8">
                          <CheckCircle2 className="w-12 h-12 text-emerald-500 mx-auto mb-3" />
                          <p className="text-gray-600">Aucune anomalie détectée — Toutes les parcelles sont conformes</p>
                        </div>
                      ) : (
                        anomalies
                          .sort((a, b) => (a.confidence || 0) - (b.confidence || 0))
                          .map((p, i) => (
                            <div key={p.id} className="border border-gray-200 rounded-lg p-4 space-y-2 hover:bg-gray-50 transition-colors">
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                  <Badge variant="outline" className="text-xs border-gray-300">Priorité {i + 1}</Badge>
                                  <span className="font-semibold text-gray-900">{p.owner_name || p.id.slice(0, 8)}</span>
                                </div>
                                <Badge className={statusBadgeClass(p.status)}>{p.status}</Badge>
                              </div>
                              <p className="text-sm text-gray-500 font-mono">{p.center_lat.toFixed(5)}, {p.center_lng.toFixed(5)} · {p.surface_ha} ha</p>
                              <p className="text-sm text-gray-600">
                                Détectée : <span className="font-medium text-gray-900">{p.culture_detected ?? "—"}</span> · NDVI : {p.ndvi_percentage != null ? `${p.ndvi_percentage}%` : "—"} · Confiance : {p.confidence != null ? `${p.confidence}%` : "—"}
                              </p>
                              {p.culture_detected && p.culture_declared && p.culture_detected.toLowerCase() !== p.culture_declared.toLowerCase() && (
                                <p className="text-sm text-red-600 font-medium">⚠️ Déclarée : {p.culture_declared} — Détectée : {p.culture_detected}</p>
                              )}
                              {p.notes && <p className="text-sm text-amber-600">📝 {p.notes}</p>}
                              <p className="text-sm text-gray-500 italic">{p.recommendations}</p>
                            </div>
                          ))
                      )}
                    </CardContent>
                  </Card>
                </TabsContent>

                {/* Phenology Tab */}
                <TabsContent value="phenology" className="space-y-5">
                  {selected && selected.time_series_s2 && selected.time_series_s2.length > 0 ? (
                    <>
                      {/* Planting Info Card */}
                      {selected.estimated_planting_date && (
                        <Card className="bg-white border-gray-200 shadow-sm">
                          <CardContent className="p-5">
                            <div className="flex items-center gap-4">
                              <div className="p-3 rounded-xl bg-emerald-100 text-emerald-600">
                                <Sprout className="w-6 h-6" />
                              </div>
                              <div className="flex-1">
                                <p className="text-lg font-bold text-gray-900">
                                  {selected.growth_stage || "—"} — Planté il y a {selected.days_since_planting ?? "?"} jours
                                </p>
                                <p className="text-sm text-gray-500">
                                  Semis estimé : {new Date(selected.estimated_planting_date).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })}
                                  {selected.planting_confidence ? ` · Confiance ${selected.planting_confidence}%` : ""}
                                </p>
                                {selected.estimated_harvest_date && (
                                  <p className="text-sm text-amber-600 mt-1">
                                    🗓️ Récolte estimée : {new Date(selected.estimated_harvest_date).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })}
                                  </p>
                                )}
                              </div>
                            </div>
                          </CardContent>
                        </Card>
                      )}

                      {/* NDVI Time Series Chart */}
                      <Card className="bg-white border-gray-200 shadow-sm">
                        <CardHeader className="pb-2 border-b border-gray-100">
                          <CardTitle className="text-base flex items-center gap-2 font-semibold text-gray-900">
                            <Leaf className="w-4 h-4 text-emerald-600" />
                            Série temporelle NDVI — {selected.owner_name || selected.id.slice(0, 8)}
                          </CardTitle>
                          <p className="text-sm text-gray-500">Évolution mensuelle du NDVI sur 6 mois (Sentinel-2)</p>
                        </CardHeader>
                        <CardContent className="pt-5">
                          <ResponsiveContainer width="100%" height={300}>
                            <ComposedChart data={selected.time_series_s2.filter(p => p.ndvi != null).map(p => ({
                              date: p.date,
                              NDVI: p.ndvi,
                              isPlanting: selected.estimated_planting_date?.slice(0, 7) === p.date,
                            }))}>
                              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                              <XAxis dataKey="date" tick={{ fill: "#6b7280", fontSize: 12 }} />
                              <YAxis tick={{ fill: "#6b7280", fontSize: 12 }} domain={[0, 100]} label={{ value: "NDVI (%)", angle: -90, position: "insideLeft", fill: "#9ca3af", fontSize: 12 }} />
                              <Tooltip contentStyle={{ backgroundColor: "white", border: "1px solid #e5e7eb", borderRadius: 8, color: "#111827" }}
                                formatter={(v: number) => [`${v.toFixed(1)}%`, "NDVI"]} />
                              <Area type="monotone" dataKey="NDVI" stroke="#10b981" fill="#10b981" fillOpacity={0.15} strokeWidth={2} />
                              <Line type="monotone" dataKey="NDVI" stroke="#10b981" strokeWidth={2} dot={{ r: 5, fill: "#10b981" }} />
                            </ComposedChart>
                          </ResponsiveContainer>
                          {selected.estimated_planting_date && (
                            <p className="text-xs text-gray-500 mt-2 text-center">
                              🌱 Semis détecté autour de {selected.estimated_planting_date.slice(0, 7)} (saut NDVI significatif)
                            </p>
                          )}
                        </CardContent>
                      </Card>

                      {/* S1 Radar Time Series */}
                      {selected.time_series_s1 && selected.time_series_s1.some(p => p.vv != null) && (
                        <Card className="bg-white border-gray-200 shadow-sm">
                          <CardHeader className="pb-2 border-b border-gray-100">
                            <CardTitle className="text-base flex items-center gap-2 font-semibold text-gray-900">
                              <Activity className="w-4 h-4 text-blue-600" />
                              Série temporelle Radar SAR (Sentinel-1)
                            </CardTitle>
                            <p className="text-sm text-gray-500">Rétrodiffusion VV et VH en dB — insensible aux nuages</p>
                          </CardHeader>
                          <CardContent className="pt-5">
                            <ResponsiveContainer width="100%" height={280}>
                              <LineChart data={selected.time_series_s1.filter(p => p.vv != null).map(p => ({
                                date: p.date,
                                VV: p.vv,
                                VH: p.vh,
                              }))}>
                                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                                <XAxis dataKey="date" tick={{ fill: "#6b7280", fontSize: 12 }} />
                                <YAxis tick={{ fill: "#6b7280", fontSize: 12 }} label={{ value: "dB", angle: -90, position: "insideLeft", fill: "#9ca3af", fontSize: 12 }} />
                                <Tooltip contentStyle={{ backgroundColor: "white", border: "1px solid #e5e7eb", borderRadius: 8, color: "#111827" }}
                                  formatter={(v: number) => [`${v.toFixed(2)} dB`]} />
                                <Legend wrapperStyle={{ paddingTop: 10 }} />
                                <Line type="monotone" dataKey="VV" stroke="#3b82f6" strokeWidth={2} dot={{ r: 4 }} />
                                <Line type="monotone" dataKey="VH" stroke="#8b5cf6" strokeWidth={2} dot={{ r: 4 }} />
                              </LineChart>
                            </ResponsiveContainer>
                          </CardContent>
                        </Card>
                      )}

                      {/* Growth Timeline */}
                      <Card className="bg-white border-gray-200 shadow-sm">
                        <CardHeader className="pb-2 border-b border-gray-100">
                          <CardTitle className="text-base flex items-center gap-2 font-semibold text-gray-900">
                            <Calendar className="w-4 h-4 text-emerald-600" />
                            Cycle de culture (orge : 90-120 jours)
                          </CardTitle>
                        </CardHeader>
                        <CardContent className="pt-5">
                          <div className="flex gap-1">
                            {["Semis", "Levée", "Tallage", "Montaison", "Épiaison", "Maturation", "Récolte"].map((stage) => {
                              const isActive = selected.growth_stage === stage;
                              const isPast = selected.growth_stage && ["Semis", "Levée", "Tallage", "Montaison", "Épiaison", "Maturation", "Récolte"]
                                .indexOf(stage) < ["Semis", "Levée", "Tallage", "Montaison", "Épiaison", "Maturation", "Récolte"]
                                .indexOf(selected.growth_stage);
                              return (
                                <div key={stage} className={`flex-1 text-center py-2 px-1 rounded text-xs font-medium transition-colors ${
                                  isActive ? "bg-emerald-500 text-white" : isPast ? "bg-emerald-100 text-emerald-700" : "bg-gray-100 text-gray-400"
                                }`}>
                                  {stage}
                                </div>
                              );
                            })}
                          </div>
                          {selected.days_since_planting != null && (
                            <div className="mt-3">
                              <Progress value={Math.min(100, (selected.days_since_planting / 110) * 100)} className="h-2 bg-gray-200" />
                              <p className="text-xs text-gray-500 mt-1 text-center">Jour {selected.days_since_planting} / ~110</p>
                            </div>
                          )}
                        </CardContent>
                      </Card>
                    </>
                  ) : (
                    <Card className="bg-white border-gray-200">
                      <CardContent className="p-12 text-center">
                        <Sprout className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                        <h2 className="text-xl font-semibold text-gray-900 mb-2">Aucune donnée phénologique</h2>
                        <p className="text-gray-500">Sélectionnez une parcelle avec des données de série temporelle pour voir l'analyse phénologique.</p>
                      </CardContent>
                    </Card>
                  )}
                </TabsContent>

                {/* Culture History Tab */}
                <TabsContent value="history" className="space-y-5">
                  <Card className="bg-white border-gray-200 shadow-sm">
                    <CardHeader className="pb-2 border-b border-gray-100">
                      <CardTitle className="text-base flex items-center gap-2 font-semibold text-gray-900">
                        <History className="w-4 h-4 text-emerald-600" />
                        Évolution du NDVI dans le temps
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="pt-5">
                      <ResponsiveContainer width="100%" height={300}>
                        <AreaChart data={cultureHistory}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                          <XAxis dataKey="date" tick={{ fill: "#6b7280", fontSize: 12 }} />
                          <YAxis tick={{ fill: "#6b7280", fontSize: 12 }} domain={[0, 100]} />
                          <Tooltip contentStyle={{ backgroundColor: "white", border: "1px solid #e5e7eb", borderRadius: 8, color: "#111827" }}
                            formatter={(value: any, name: string) => [value + "%", name === "ndvi" ? "NDVI" : name]} />
                          <Area type="monotone" dataKey="ndvi" stroke="#10b981" fill="#10b981" fillOpacity={0.2} name="NDVI" />
                        </AreaChart>
                      </ResponsiveContainer>
                    </CardContent>
                  </Card>

                  <Card className="bg-white border-gray-200 shadow-sm">
                    <CardHeader className="pb-2 border-b border-gray-100">
                      <CardTitle className="text-base flex items-center gap-2 font-semibold text-gray-900">
                        <Calendar className="w-4 h-4 text-emerald-600" />
                        Journal des analyses
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="pt-5">
                      <Table>
                        <TableHeader className="bg-gray-50">
                          <TableRow className="border-gray-200">
                            <TableHead className="text-gray-700">Date</TableHead>
                            <TableHead className="text-gray-700">Propriétaire</TableHead>
                            <TableHead className="text-gray-700">Culture détectée</TableHead>
                            <TableHead className="text-gray-700">NDVI</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {cultureHistory.map((row, i) => (
                            <TableRow key={i} className="border-gray-100">
                              <TableCell className="text-sm text-gray-500">{row.date}</TableCell>
                              <TableCell className="font-medium text-gray-900">{row.owner}</TableCell>
                              <TableCell className="text-gray-700">{row.culture}</TableCell>
                              <TableCell className="font-semibold text-gray-900">{row.ndvi != null ? `${row.ndvi}%` : "—"}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </CardContent>
                  </Card>
                </TabsContent>
              </Tabs>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
