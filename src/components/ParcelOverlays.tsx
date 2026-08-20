import { useEffect, useRef } from "react";
import type { Parcelle } from "@/hooks/useParcelles";

const AUTOMATIC_BARLEY_SEGMENT_PREFIX = "automatic-orge-segment:";

const htmlEntities: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => htmlEntities[character]);
}

interface ParcelOverlaysProps {
  map: google.maps.Map | null;
  parcelles: Parcelle[];
}

export default function ParcelOverlays({ map, parcelles }: ParcelOverlaysProps) {
  const polygonsRef = useRef<google.maps.Polygon[]>([]);
  const infoWindowRef = useRef<google.maps.InfoWindow | null>(null);

  useEffect(() => {
    if (!map) return;

    // Clean old polygons
    polygonsRef.current.forEach((p) => p.setMap(null));
    polygonsRef.current = [];

    if (!infoWindowRef.current) {
      infoWindowRef.current = new google.maps.InfoWindow();
    }

    parcelles
      .filter((parcelle) => parcelle.label.startsWith(AUTOMATIC_BARLEY_SEGMENT_PREFIX))
      .forEach((parcelle) => {
        const path = parcelle.coordinates.map((c) => ({ lat: c.lat, lng: c.lng }));
        const color = "#fbbf24";

        const polygon = new google.maps.Polygon({
          paths: path,
          strokeColor: color,
          strokeWeight: 4,
          strokeOpacity: 0.98,
          fillColor: color,
          fillOpacity: 0.2,
          zIndex: 10,
          map,
        });

        polygon.addListener("mouseover", (e: google.maps.PolyMouseEvent) => {
          polygon.setOptions({ fillOpacity: 0.42, strokeWeight: 5 });
          const owner = escapeHtml(parcelle.owner_name || "Orge détectée");
          const note = escapeHtml(parcelle.notes || "Contour d’orge détecté automatiquement.");
          const culture = escapeHtml(parcelle.culture_detected || "Orge");
          const content = `
            <div style="font-family:'Space Grotesk',sans-serif;color:#333;min-width:180px;padding:4px">
              <div style="font-weight:600;font-size:14px;margin-bottom:6px">${owner}</div>
              <div style="font-size:12px;color:#666;margin-bottom:4px">${note}</div>
              <div style="font-size:11px;color:#999">${culture} · NDVI: ${parcelle.ndvi_percentage ?? "—"}%</div>
            </div>
          `;
          infoWindowRef.current!.setContent(content);
          if (e.latLng) {
            infoWindowRef.current!.setPosition(e.latLng);
            infoWindowRef.current!.open(map);
          }
        });

        polygon.addListener("mouseout", () => {
          polygon.setOptions({ fillOpacity: 0.2, strokeWeight: 4 });
          infoWindowRef.current?.close();
        });

        polygonsRef.current.push(polygon);
      });

    return () => {
      polygonsRef.current.forEach((p) => p.setMap(null));
      polygonsRef.current = [];
    };
  }, [map, parcelles]);

  return null;
}
