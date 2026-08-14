import { useEffect, useRef } from "react";
import type { Parcelle } from "@/hooks/useParcelles";

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

    parcelles.forEach((parcelle) => {
      const path = parcelle.coordinates.map((c) => ({ lat: c.lat, lng: c.lng }));

      const detectedCulture = parcelle.culture_detected?.toLowerCase() ?? "";
      const isBarley = detectedCulture.includes("orge") && !detectedCulture.includes("non");
      const isConforme = parcelle.verdict?.toUpperCase().includes("CONFORME") && !parcelle.verdict?.toUpperCase().includes("NON");
      const color = isBarley ? "#facc15" : isConforme ? "hsl(142, 60%, 45%)" : "hsl(0, 65%, 50%)";

      const polygon = new google.maps.Polygon({
        paths: path,
        strokeColor: color,
        strokeWeight: isBarley ? 3 : 2,
        fillColor: color,
        fillOpacity: isBarley ? 0.38 : 0.15,
        map,
      });

      polygon.addListener("mouseover", (e: google.maps.PolyMouseEvent) => {
        polygon.setOptions({ fillOpacity: 0.35 });
        const owner = parcelle.owner_name || "Non renseigné";
        const note = parcelle.notes || "Aucune note";
        const content = `
          <div style="font-family:'Space Grotesk',sans-serif;color:#333;min-width:180px;padding:4px">
            <div style="font-weight:600;font-size:14px;margin-bottom:6px">👤 ${owner}</div>
            <div style="font-size:12px;color:#666;margin-bottom:4px">📝 ${note}</div>
            <div style="font-size:11px;color:#999">${parcelle.culture_detected || "—"} · NDVI: ${parcelle.ndvi_percentage ?? "—"}%</div>
          </div>
        `;
        infoWindowRef.current!.setContent(content);
        if (e.latLng) {
          infoWindowRef.current!.setPosition(e.latLng);
          infoWindowRef.current!.open(map);
        }
      });

      polygon.addListener("mouseout", () => {
        polygon.setOptions({ fillOpacity: isBarley ? 0.38 : 0.15 });
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
