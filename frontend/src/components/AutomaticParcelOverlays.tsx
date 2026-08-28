import { useEffect, useRef } from "react";
import { getDetectedBarleySegments, type AutomaticParcel } from "@/lib/automatic-parcels";

interface AutomaticParcelOverlaysProps {
  map: google.maps.Map | null;
  parcels: AutomaticParcel[];
}

export const SOURCE_LABELS: Record<string, string> = {
  "osm": "Contour OSM (réel)",
  "database": "Parcelle enregistrée",
  "field-boundary-model": "Modèle IA (U-Net)",
  "gee-watershed-segmentation": "Watershed (GEE)",
  "gee-snic-segmentation": "SNIC (GEE)",
  "satellite-search-cell": "Fenêtre satellite (sans contour)",
};

export default function AutomaticParcelOverlays({ map, parcels }: AutomaticParcelOverlaysProps) {
  const polygonsRef = useRef<google.maps.Polygon[]>([]);
  const infoWindowRef = useRef<google.maps.InfoWindow | null>(null);

  useEffect(() => {
    if (!map) return;

    polygonsRef.current.forEach((polygon) => polygon.setMap(null));
    polygonsRef.current = [];
    if (!infoWindowRef.current) infoWindowRef.current = new google.maps.InfoWindow();

    // Contour réel de chaque parcelle candidate (Overpass, base, modèle IA, watershed,
    // SNIC...), indépendamment du résultat de la classification orge — sans ça, le
    // contour tracé par le modèle n'apparaît jamais si la confiance orge est < 70%.
    parcels.forEach((parcel) => {
      const path = cleanPolygonPath(parcel.coordinates);
      if (path.length < 3) return;

      const boundaryPolygon = new google.maps.Polygon({
        paths: path,
        strokeColor: "#38bdf8",
        strokeWeight: 2,
        strokeOpacity: 0.9,
        fillColor: "#38bdf8",
        fillOpacity: 0.05,
        zIndex: 10,
        map,
      });
      boundaryPolygon.addListener("mouseover", (event: google.maps.PolyMouseEvent) => {
        boundaryPolygon.setOptions({ fillOpacity: 0.18, strokeWeight: 3 });
        const content = document.createElement("div");
        content.style.cssText = "font-family:'Space Grotesk',sans-serif;color:#333;min-width:160px;padding:4px";
        const title = document.createElement("strong");
        title.textContent = SOURCE_LABELS[parcel.tags.source ?? ""] ?? "Contour détecté";
        content.append(title);
        if (event.latLng) {
          infoWindowRef.current?.setContent(content);
          infoWindowRef.current?.setPosition(event.latLng);
          infoWindowRef.current?.open(map);
        }
      });
      boundaryPolygon.addListener("mouseout", () => {
        boundaryPolygon.setOptions({ fillOpacity: 0.05, strokeWeight: 2 });
        infoWindowRef.current?.close();
      });
      polygonsRef.current.push(boundaryPolygon);
    });

    const barleySegments = parcels.flatMap(getDetectedBarleySegments);
    console.info(`[MAP] Parcelles d'orge affichées : ${barleySegments.length}`);

    barleySegments.forEach((segment) => {
      const path = cleanPolygonPath(segment.coordinates);
      if (path.length < 3) return;

      const polygon = new google.maps.Polygon({
        paths: path,
        strokeColor: "#fbbf24",
        strokeWeight: 4,
        strokeOpacity: 1,
        fillColor: "#facc15",
        fillOpacity: 0.2,
        zIndex: 20,
        map,
      });
      polygon.addListener("mouseover", (event: google.maps.PolyMouseEvent) => {
        polygon.setOptions({ fillOpacity: 0.42, strokeWeight: 5 });
        const content = document.createElement("div");
        content.style.cssText = "font-family:'Space Grotesk',sans-serif;color:#333;min-width:160px;padding:4px";
        const title = document.createElement("strong");
        title.textContent = `Orge détectée (${segment.confidence}%)`;
        const details = document.createElement("div");
        details.style.cssText = "font-size:11px;color:#666;margin-top:4px;line-height:1.5";
        const ndvi = segment.ndvi != null ? `NDVI : ${segment.ndvi.toFixed(2)}` : "NDVI : —";
        details.textContent = `${segment.area_ha} ha · ${ndvi}`;
        content.append(title, details);
        if (event.latLng) {
          infoWindowRef.current?.setContent(content);
          infoWindowRef.current?.setPosition(event.latLng);
          infoWindowRef.current?.open(map);
        }
      });
      polygon.addListener("mouseout", () => {
        polygon.setOptions({ fillOpacity: 0.2, strokeWeight: 4 });
        infoWindowRef.current?.close();
      });
      polygonsRef.current.push(polygon);
    });

    return () => {
      polygonsRef.current.forEach((polygon) => polygon.setMap(null));
      polygonsRef.current = [];
      infoWindowRef.current?.close();
    };
  }, [map, parcels]);

  return null;
}

function cleanPolygonPath(points: Array<{ lat: number; lng: number }>): Array<{ lat: number; lng: number }> {
  const path = points.filter((point) => Number.isFinite(point.lat) && Number.isFinite(point.lng));
  const cleaned: Array<{ lat: number; lng: number }> = [];

  path.forEach((point) => {
    const previous = cleaned.at(-1);
    if (!previous || previous.lat !== point.lat || previous.lng !== point.lng) {
      cleaned.push(point);
    }
  });

  const first = cleaned[0];
  const last = cleaned.at(-1);
  if (first && last && first.lat === last.lat && first.lng === last.lng) {
    cleaned.pop();
  }

  return cleaned;
}
