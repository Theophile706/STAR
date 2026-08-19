import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { DEFAULT_BARLEY_DETECTION_CONFIG, type BarleyDetectionConfig } from "@/lib/barley-detection";
import { getDetectedBarleySegments, type AutomaticParcelSearchResult } from "@/lib/automatic-parcels";
import { LocateFixed, MapPinned, Navigation, Radar, ThermometerSun } from "lucide-react";

interface CoordinateInputProps {
  onNavigate: (lat: number, lng: number, radiusKm: number) => void;
  onSearch: (lat: number, lng: number, radiusKm: number, config: BarleyDetectionConfig) => Promise<void>;
  search: AutomaticParcelSearchResult | null;
  isSearching: boolean;
  searchError: string;
  pickedLocation: { lat: number; lng: number } | null;
}

export default function CoordinateInput({ onNavigate, onSearch, search, isSearching, searchError, pickedLocation }: CoordinateInputProps) {
  const [lat, setLat] = useState("");
  const [lng, setLng] = useState("");
  const [radiusValue, setRadiusValue] = useState("10");
  const [radiusUnit, setRadiusUnit] = useState<"m" | "km">("km");
  const [baseTemperature, setBaseTemperature] = useState(String(DEFAULT_BARLEY_DETECTION_CONFIG.baseTemperature));
  const [threshold, setThreshold] = useState(String(DEFAULT_BARLEY_DETECTION_CONFIG.threshold));
  const [periodDays, setPeriodDays] = useState("130");
  const [expanded, setExpanded] = useState(true);
  const [validationError, setValidationError] = useState("");
  const [isLocating, setIsLocating] = useState(false);
  const [locationError, setLocationError] = useState("");
  const detectedSegments = search?.parcels.flatMap(getDetectedBarleySegments) ?? [];

  useEffect(() => {
    if (!pickedLocation) return;
    setLat(pickedLocation.lat.toFixed(6));
    setLng(pickedLocation.lng.toFixed(6));
    setExpanded(true);
  }, [pickedLocation]);

  const handleUseMyLocation = () => {
    if (!("geolocation" in navigator)) {
      setLocationError("La géolocalisation n’est pas disponible sur cet appareil.");
      return;
    }
    setLocationError("");
    setIsLocating(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const latNum = position.coords.latitude;
        const lngNum = position.coords.longitude;
        setLat(latNum.toFixed(6));
        setLng(lngNum.toFixed(6));
        setIsLocating(false);
        const radiusNum = toRadiusKm(radiusValue, radiusUnit);
        onNavigate(latNum, lngNum, Number.isFinite(radiusNum) ? radiusNum : 10);
      },
      (error) => {
        setIsLocating(false);
        setLocationError(
          error.code === error.PERMISSION_DENIED
            ? "Accès à la position refusé. Autorisez la localisation dans votre navigateur."
            : "Impossible de récupérer votre position."
        );
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const latNum = Number(lat);
    const lngNum = Number(lng);
    const radiusInput = Number(radiusValue);
    const radiusNum = radiusUnit === "m" ? radiusInput / 1000 : radiusInput;
    const config = {
      baseTemperature: Number(baseTemperature),
      threshold: Number(threshold),
      periodDays: Number(periodDays),
    };

    if (!Number.isFinite(latNum) || latNum < -90 || latNum > 90 || !Number.isFinite(lngNum) || lngNum < -180 || lngNum > 180) {
      setValidationError("Saisissez une latitude et une longitude valides.");
      return;
    }
    if (!Number.isFinite(radiusInput) || radiusInput <= 0 || !Number.isFinite(radiusNum) || radiusNum < 0.05 || radiusNum > 20) {
      setValidationError("Le rayon doit être compris entre 50 m et 20 km.");
      return;
    }
    if (!Number.isFinite(config.baseTemperature) || config.baseTemperature < -20 || config.baseTemperature > 30) {
      setValidationError("Tbase doit être compris entre -20 et 30 °C.");
      return;
    }
    if (!Number.isFinite(config.threshold) || config.threshold < DEFAULT_BARLEY_DETECTION_CONFIG.threshold || config.threshold > 10000) {
      setValidationError("Le seuil nécessaire doit être compris entre 2 200 et 10 000 °C.");
      return;
    }
    if (!Number.isInteger(config.periodDays) || config.periodDays < 1 || config.periodDays > 730) {
      setValidationError("La période doit être comprise entre 1 et 730 jours.");
      return;
    }

    setValidationError("");
    onNavigate(latNum, lngNum, radiusNum);
    await onSearch(latNum, lngNum, radiusNum, config);
  };

  if (!expanded) {
    return (
      <button
        onClick={() => setExpanded(true)}
        className="absolute top-4 right-4 z-[800] analysis-popup p-3 hover:scale-105 transition-transform"
        title="Rechercher des parcelles autour d’une coordonnée"
      >
        <MapPinned className="w-5 h-5 text-primary" />
      </button>
    );
  }

  return (
    <div className="absolute top-4 right-4 bottom-24 sm:bottom-auto z-[800] analysis-popup p-4 w-[min(20rem,calc(100vw-2rem))] max-h-none sm:max-h-[calc(100vh-2rem)] overflow-y-auto">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Radar className="w-4 h-4 text-primary" />
          <span className="text-sm font-semibold text-foreground">Recherche automatique</span>
        </div>
        <button
          onClick={() => setExpanded(false)}
          className="w-6 h-6 flex items-center justify-center rounded-full bg-muted text-muted-foreground hover:text-foreground text-xs"
        >
          ✕
        </button>
      </div>
      <p className="text-xs text-muted-foreground mb-1">La recherche utilise les contours agricoles, les images satellite et le modèle HF avant d’afficher les parcelles d’orge.</p>
      <p className="text-xs text-muted-foreground mb-3">Astuce : glissez ou touchez le repère vert sur la carte pour choisir un point, les coordonnées se remplissent automatiquement.</p>
      <form onSubmit={handleSubmit} className="space-y-2">
        {locationError && <p className="text-xs text-destructive">{locationError}</p>}
        <Input
          type="number"
          step="any"
          placeholder="Latitude (ex. -18.8792)"
          value={lat}
          onChange={(e) => setLat(e.target.value)}
          className="bg-background/50 text-sm h-9"
        />
        <Input
          type="number"
          step="any"
          placeholder="Longitude (ex. 47.5079)"
          value={lng}
          onChange={(e) => setLng(e.target.value)}
          className="bg-background/50 text-sm h-9"
        />
        <label className="block text-xs text-muted-foreground">
          Rayon terrain réel
          <div className="mt-1 flex gap-1">
            <Input
              type="number"
              min={radiusUnit === "m" ? "50" : "0.05"}
              max={radiusUnit === "m" ? "20000" : "20"}
              step={radiusUnit === "m" ? "10" : "0.05"}
              value={radiusValue}
              onChange={(e) => setRadiusValue(e.target.value)}
              className="bg-background/50 text-sm h-9 flex-1"
            />
            <select
              value={radiusUnit}
              onChange={(e) => setRadiusUnit(e.target.value as "m" | "km")}
              className="h-9 rounded-md border border-input bg-background/50 px-2 text-sm text-foreground"
            >
              <option value="m">m</option>
              <option value="km">km</option>
            </select>
          </div>
          <span className="mt-1 block text-[11px]">Distance au sol, indépendante du zoom · 50 m à 20 km</span>
        </label>
        <div className="rounded-lg border border-border/70 bg-muted/40 p-2.5 space-y-2">
          <div className="flex items-center gap-1.5 text-xs font-medium text-foreground">
            <ThermometerSun className="w-3.5 h-3.5 text-primary" />
            Paramètres degrés-jours
          </div>
          <div className="grid grid-cols-2 gap-2">
            <label className="text-[11px] text-muted-foreground">
              Tbase (°C)
              <Input type="number" min="-20" max="30" step="0.1" value={baseTemperature} onChange={(e) => setBaseTemperature(e.target.value)} className="mt-1 h-8 text-xs bg-background/70" />
            </label>
            <label className="text-[11px] text-muted-foreground">
              Seuil nécessaire (°C)
              <Input type="number" min={DEFAULT_BARLEY_DETECTION_CONFIG.threshold} max="10000" step="1" value={threshold} onChange={(e) => setThreshold(e.target.value)} className="mt-1 h-8 text-xs bg-background/70" />
            </label>
          </div>
          <label className="block text-[11px] text-muted-foreground">
            Période de culture (jours)
            <Input type="number" min="1" max="730" step="1" value={periodDays} onChange={(e) => setPeriodDays(e.target.value)} className="mt-1 h-8 text-xs bg-background/70" />
          </label>
        </div>
        {validationError && <p className="text-xs text-destructive">{validationError}</p>}
        {searchError && <p className="text-xs text-destructive">{searchError}</p>}
        <Button type="submit" size="sm" className="w-full gap-2" disabled={isSearching}>
          {isSearching
            ? <span key="icon" className="w-3.5 h-3.5 rounded-full border-2 border-primary-foreground/40 border-t-primary-foreground animate-spin" />
            : <Navigation key="icon" className="w-4 h-4" />}
          <span key="label">{isSearching ? "Analyse HF + satellite..." : "Lancer l’analyse automatique"}</span>
        </Button>
      </form>
      {search && (
        <div className="mt-3 rounded-lg border border-border bg-muted/40 p-3 space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-foreground">Résultat de la zone</p>
            <span className="text-xs font-mono text-muted-foreground">{formatGroundRadius(search.radius_km)}</span>
          </div>
          <div className="grid grid-cols-2 gap-2 text-center">
            <div className="rounded-md bg-background/60 p-2">
              <p className="text-lg font-semibold text-foreground">{search.candidates_found}</p>
              <p className="text-[10px] text-muted-foreground">zones candidates</p>
            </div>
            <div className="rounded-md bg-yellow-300/30 p-2">
              <p className="text-lg font-semibold text-yellow-700">{detectedSegments.length}</p>
              <p className="text-[10px] text-yellow-800">objets d’orge</p>
            </div>
          </div>
          <p className="text-[11px] text-muted-foreground">Rayon terrain réel : {search.radius_km} km · {search.analyzed_count} zone(s) analysée(s) par cellules, puis segmentée(s) par SNIC avant la classification HF.</p>
          <p className="text-[11px] text-muted-foreground">Degrés-jours requis : {search.threshold} °C · Tbase : {search.base_temperature} °C · période : {search.period_days} jours.</p>
          {search.notice && <p className="rounded-md bg-amber-100/80 px-2 py-1.5 text-[11px] text-amber-900">{search.notice}</p>}
          <p className="text-[11px] text-yellow-800">Jaune : uniquement les objets SNIC que le modèle HF a classifiés comme Orge.</p>
          {search.candidates_found > search.analyzed_count && <p className="text-[11px] text-amber-700">La zone contient plus de candidates que la limite d’analyse automatique.</p>}
          {detectedSegments.length > 0 && (
            <div className="rounded-md border border-yellow-400/70 bg-yellow-300/20 p-2.5 space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-yellow-900">Objets d’orge détectés</p>
                <span className="text-[11px] font-medium text-yellow-800">{detectedSegments.length} objet(s)</span>
              </div>
              {detectedSegments.map((segment, index) => (
                <div key={`${segment.coordinates[0]?.lat}-${segment.coordinates[0]?.lng}-${index}`} className="rounded-md bg-background/70 p-2 text-[11px] text-foreground space-y-1">
                  <div className="flex items-center justify-between font-medium">
                    <span>Parcelle {index + 1}</span>
                    <span className="text-yellow-700">Confiance : {segment.confidence}%</span>
                  </div>
                  <p>Surface : {segment.area_ha} ha</p>
                  <p>NDVI : {segment.ndvi?.toFixed(2) ?? "—"}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function toRadiusKm(value: string, unit: "m" | "km"): number {
  const numericValue = Number(value);
  return unit === "m" ? numericValue / 1000 : numericValue;
}

function formatGroundRadius(radiusKm: number): string {
  const meters = Math.round(radiusKm * 1000);
  return meters < 1000 ? `${meters} m au sol` : `${Number(radiusKm.toFixed(2))} km au sol`;
}
