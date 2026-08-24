import { useEffect, useRef } from "react";
import type { SimpleAnalysisResult } from "@/lib/barley-detect-simple";

interface SimpleFieldOverlaysProps {
  map: google.maps.Map | null;
  result: SimpleAnalysisResult | null;
}

export default function SimpleFieldOverlays({ map, result }: SimpleFieldOverlaysProps) {
  const polygonsRef = useRef<google.maps.Polygon[]>([]);
  const infoWindowRef = useRef<google.maps.InfoWindow | null>(null);

  useEffect(() => {
    if (!map) return;

    polygonsRef.current.forEach((polygon) => polygon.setMap(null));
    polygonsRef.current = [];
    if (!infoWindowRef.current) infoWindowRef.current = new google.maps.InfoWindow();

    (result?.features ?? []).forEach((feature) => {
      const ring = feature.geometry.coordinates[0];
      if (!ring || ring.length < 3) return;
      const path = ring.map(([lng, lat]) => ({ lat, lng }));

      const polygon = new google.maps.Polygon({
        paths: path,
        strokeColor: "#22d3ee",
        strokeWeight: 4,
        strokeOpacity: 1,
        fillColor: "#22d3ee",
        fillOpacity: 0.2,
        zIndex: 20,
        map,
      });
      polygon.addListener("mouseover", (event: google.maps.PolyMouseEvent) => {
        polygon.setOptions({ fillOpacity: 0.42, strokeWeight: 5 });
        const { confidence, areaHa, meanNDVI, meanNDRE, imageDate, imageAgeDays, cloudPercentage } = feature.properties;
        const content = document.createElement("div");
        content.style.cssText = "font-family:'Space Grotesk',sans-serif;color:#333;min-width:180px;padding:4px";
        const title = document.createElement("strong");
        title.textContent = `Orge (analyse simple) — ${Math.round(confidence * 100)}%`;
        const details = document.createElement("div");
        details.style.cssText = "font-size:11px;color:#666;margin-top:4px;line-height:1.6";
        details.innerHTML = [
          `${areaHa} ha`,
          `NDVI : ${meanNDVI != null ? meanNDVI.toFixed(2) : "—"} · NDRE : ${meanNDRE != null ? meanNDRE.toFixed(2) : "—"}`,
          `Image : ${imageDate ?? "—"} (${imageAgeDays ?? "?"} j) · nuages ${cloudPercentage ?? "?"}%`,
        ].join("<br/>");
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
  }, [map, result]);

  return null;
}
