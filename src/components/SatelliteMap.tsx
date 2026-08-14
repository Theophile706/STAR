import { useCallback, useEffect, useRef, useState } from "react";
import { GoogleMap, useJsApiLoader } from "@react-google-maps/api";
import AutomaticParcelOverlays from "./AutomaticParcelOverlays";
import CoordinateInput from "./CoordinateInput";
import ParcelOverlays from "./ParcelOverlays";
import { useNavigate } from "react-router-dom";
import { BarChart3 } from "lucide-react";
import { searchAutomaticParcels, type AutomaticParcelSearchResult } from "@/lib/automatic-parcels";
import type { BarleyDetectionConfig } from "@/lib/barley-detection";
import { useParcelles } from "@/hooks/useParcelles";

const GOOGLE_MAPS_API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;

const DEFAULT_CENTER = { lat: 48.8566, lng: 2.3522 };
const DEFAULT_ZOOM = 4;
const TARGET_ZOOM = 16;
const ANALYSIS_VIEWPORT_PADDING = 1.25;
const LIBRARIES: ("geometry")[] = ["geometry"];

const mapContainerStyle = { width: "100%", height: "100%" };

const mapOptions: google.maps.MapOptions = {
  mapTypeId: "satellite",
  disableDefaultUI: true,
  zoomControl: true,
  zoomControlOptions: { position: 9 /* RIGHT_BOTTOM */ },
  mapTypeControl: false,
  streetViewControl: false,
  fullscreenControl: false,
};

export default function SatelliteMap() {
  const mapRef = useRef<google.maps.Map | null>(null);
  const searchAreaRef = useRef<google.maps.Circle | null>(null);
  const cursorMarkerRef = useRef<google.maps.Marker | null>(null);
  const [located, setLocated] = useState(false);
  const [pinMarker, setPinMarker] = useState<google.maps.Marker | null>(null);
  const [pickedLocation, setPickedLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [searchResult, setSearchResult] = useState<AutomaticParcelSearchResult | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const navigate = useNavigate();
  const { parcelles } = useParcelles();
  const confirmedBarleyCount = searchResult?.parcels.filter((parcel) => parcel.analysis?.barley_presence === "confirmed").length ?? 0;
  const probableBarleyCount = searchResult?.parcels.filter((parcel) => parcel.analysis?.barley_presence === "probable").length ?? 0;

  const { isLoaded } = useJsApiLoader({
    googleMapsApiKey: GOOGLE_MAPS_API_KEY,
    libraries: LIBRARIES,
  });

  const placeCursorMarker = useCallback((map: google.maps.Map, latlng: google.maps.LatLngLiteral) => {
    if (cursorMarkerRef.current) {
      cursorMarkerRef.current.setPosition(latlng);
    } else {
      const marker = new google.maps.Marker({
        position: latlng,
        map,
        draggable: true,
        cursor: "grab",
        zIndex: 999,
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          scale: 8,
          fillColor: "hsl(142, 50%, 45%)",
          fillOpacity: 0.9,
          strokeColor: "#ffffff",
          strokeWeight: 2,
        },
        title: "Glissez ou touchez la carte pour choisir un point GPS",
      });
      marker.addListener("dragend", () => {
        const pos = marker.getPosition();
        if (pos) setPickedLocation({ lat: pos.lat(), lng: pos.lng() });
      });
      cursorMarkerRef.current = marker;
    }
    setPickedLocation(latlng);
  }, []);

  const onMapLoad = useCallback((map: google.maps.Map) => {
    mapRef.current = map;

    map.addListener("click", (e: google.maps.MapMouseEvent) => {
      if (!e.latLng) return;
      placeCursorMarker(map, { lat: e.latLng.lat(), lng: e.latLng.lng() });
    });

    // Try geolocation
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const latlng = { lat: pos.coords.latitude, lng: pos.coords.longitude };
          map.panTo(latlng);
          map.setZoom(TARGET_ZOOM);
          placeCursorMarker(map, latlng);
          setLocated(true);
        },
        () => {
          const latlng = { lat: 47.2, lng: 1.8 };
          map.panTo(latlng);
          map.setZoom(TARGET_ZOOM);
          placeCursorMarker(map, latlng);
          setLocated(true);
        }
      );
    } else {
      const latlng = { lat: 47.2, lng: 1.8 };
      map.panTo(latlng);
      map.setZoom(TARGET_ZOOM);
      placeCursorMarker(map, latlng);
      setLocated(true);
    }

    // Keep the map ready for the next automatic search.
  }, [placeCursorMarker]);

  const handleNavigate = useCallback((lat: number, lng: number, radiusKm: number) => {
    if (!mapRef.current) return;
    const map = mapRef.current;
    const latlng = { lat, lng };
    const bounds = boundsForRadius(lat, lng, radiusKm);
    map.fitBounds(bounds);

    if (pinMarker) pinMarker.setMap(null);
    const marker = new google.maps.Marker({
      position: latlng,
      map,
      animation: google.maps.Animation.DROP,
      title: `${lat.toFixed(5)}, ${lng.toFixed(5)}`,
    });
    setPinMarker(marker);

    searchAreaRef.current?.setMap(null);
    searchAreaRef.current = new google.maps.Circle({
      center: latlng,
      radius: radiusKm * 1000,
      strokeColor: "#facc15",
      strokeOpacity: 0.55,
      strokeWeight: 2,
      fillColor: "#facc15",
      fillOpacity: 0.04,
      map,
    });
  }, [pinMarker]);

  const handleAutomaticSearch = useCallback(async (lat: number, lng: number, radiusKm: number, config: BarleyDetectionConfig) => {
    setIsSearching(true);
    setSearchError("");
    setSearchResult(null);
    try {
      const result = await searchAutomaticParcels(lat, lng, radiusKm, config);
      setSearchResult(result);
    } catch (error) {
      setSearchError(error instanceof Error ? error.message : "La recherche automatique a échoué.");
    } finally {
      setIsSearching(false);
    }
  }, []);

  useEffect(() => () => {
    searchAreaRef.current?.setMap(null);
  }, []);

  if (!isLoaded) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4">
          <div className="relative w-16 h-16">
            <div className="absolute inset-0 rounded-full border-2 border-muted" />
            <div className="absolute inset-0 rounded-full border-2 border-primary border-t-transparent animate-spin" />
          </div>
          <span className="text-foreground font-medium">Chargement de Google Maps...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="relative w-full h-full overflow-hidden">
      <GoogleMap
        mapContainerStyle={mapContainerStyle}
        center={DEFAULT_CENTER}
        zoom={DEFAULT_ZOOM}
        options={mapOptions}
        onLoad={onMapLoad}
      />

      {!located && (
        <div className="absolute inset-0 z-[900] flex items-center justify-center bg-background/80 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-4">
            <div className="relative w-16 h-16">
              <div className="absolute inset-0 rounded-full border-2 border-muted" />
              <div className="absolute inset-0 rounded-full border-2 border-primary border-t-transparent animate-spin" />
            </div>
            <span className="text-foreground font-medium">Localisation en cours...</span>
            <span className="text-muted-foreground text-sm">Chargement de l'imagerie satellite</span>
          </div>
        </div>
      )}

      {/* Brand */}
      <div className="absolute top-4 left-4 z-[800] analysis-popup px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="w-3 h-3 rounded-full bg-primary animate-pulse" />
          <div>
            <h1 className="text-sm font-semibold text-foreground">AgriSat</h1>
            <p className="text-xs text-muted-foreground">Détection IA des cultures</p>
          </div>
        </div>
      </div>

      {/* Existing saved parcel overlays */}
      <ParcelOverlays map={mapRef.current} parcelles={parcelles} />

      {/* Parcels discovered from the GPS search */}
      <AutomaticParcelOverlays map={mapRef.current} parcels={searchResult?.parcels ?? []} />

      {/* Automatic GPS search */}
      <CoordinateInput
        onNavigate={handleNavigate}
        onSearch={handleAutomaticSearch}
        search={searchResult}
        isSearching={isSearching}
        searchError={searchError}
        pickedLocation={pickedLocation}
      />

      {/* Dashboard link */}
      <button
        onClick={() => navigate("/dashboard")}
        className="absolute bottom-8 right-20 z-[850] analysis-popup px-4 py-3 flex items-center gap-2 hover:scale-105 transition-transform"
      >
        <BarChart3 className="w-4 h-4 text-primary" />
        <span className="text-sm text-foreground font-medium">Tableau de bord</span>
      </button>

      {located && !searchResult && !isSearching && (
        <div className="absolute bottom-8 left-4 right-32 sm:left-1/2 sm:right-auto sm:-translate-x-1/2 sm:max-w-md z-[800] analysis-popup px-5 py-3 animate-fade-in">
          <p className="text-sm text-muted-foreground">
            <span className="text-primary font-medium">Entrez une coordonnée GPS</span> pour rechercher automatiquement les parcelles agricoles alentour
          </p>
        </div>
      )}

      {searchResult && (
        <div className="absolute bottom-8 left-4 right-32 sm:left-1/2 sm:right-auto sm:-translate-x-1/2 sm:max-w-lg z-[800] analysis-popup px-4 py-2.5 animate-fade-in">
          <p className="text-xs text-muted-foreground">
            <span className="inline-block w-2.5 h-2.5 rounded-sm bg-orange-400 mr-2 align-middle" />
            {probableBarleyCount} zone(s) probable(s) · {searchResult.candidates_found} parcelle(s) agricole(s)
          </p>
        </div>
      )}
    </div>
  );
}

function boundsForRadius(lat: number, lng: number, radiusKm: number): google.maps.LatLngBoundsLiteral {
  const viewportRadiusKm = radiusKm * ANALYSIS_VIEWPORT_PADDING;
  const latDelta = viewportRadiusKm / 110.574;
  const longitudeScale = Math.max(Math.abs(Math.cos((lat * Math.PI) / 180)), 0.1);
  const lngDelta = viewportRadiusKm / (111.32 * longitudeScale);
  return {
    north: lat + latDelta,
    south: lat - latDelta,
    east: lng + lngDelta,
    west: lng - lngDelta,
  };
}
