import { useEffect, useRef } from "react";
import { isAutomaticBarleyParcel, type AutomaticParcel } from "@/lib/automatic-parcels";

interface AutomaticParcelOverlaysProps {
  map: google.maps.Map | null;
  parcels: AutomaticParcel[];
}

export default function AutomaticParcelOverlays({ map, parcels }: AutomaticParcelOverlaysProps) {
  const polygonsRef = useRef<google.maps.Polygon[]>([]);
  const infoWindowRef = useRef<google.maps.InfoWindow | null>(null);

  useEffect(() => {
    if (!map) return;

    polygonsRef.current.forEach((polygon) => polygon.setMap(null));
    polygonsRef.current = [];
    if (!infoWindowRef.current) infoWindowRef.current = new google.maps.InfoWindow();

    parcels.forEach((parcel) => {
      const isBarley = isAutomaticBarleyParcel(parcel);
      const presence = parcel.analysis?.barley_presence;
      const isProbable = presence === "probable";
      const color = presence === "confirmed" ? "#facc15" : isProbable ? "#fb923c" : "#38bdf8";
      const polygon = new google.maps.Polygon({
        paths: parcel.coordinates,
        strokeColor: color,
        strokeWeight: isBarley ? 3 : 1.5,
        strokeOpacity: 0.95,
        fillColor: color,
        fillOpacity: isBarley ? 0.42 : 0.12,
        map,
        clickable: true,
      });

      polygon.addListener("mouseover", (event: google.maps.PolyMouseEvent) => {
        polygon.setOptions({ fillOpacity: isBarley ? 0.62 : 0.28 });
        const content = document.createElement("div");
        content.style.cssText = "font-family:'Space Grotesk',sans-serif;color:#333;min-width:180px;padding:4px";
        const title = document.createElement("strong");
        title.textContent = presence === "confirmed" ? "Orge confirmée" : isProbable ? "Zone de présence probable d’orge" : "Parcelle agricole";
        const detail = document.createElement("div");
        detail.style.cssText = "font-size:11px;color:#666;margin-top:4px;line-height:1.5";
        const analysis = parcel.analysis;
        const gddInfo = analysis?.gdd_cumulative != null && analysis.gdd_threshold != null
          ? `Cumul Dj : ${analysis.gdd_cumulative}/${analysis.gdd_threshold} °C`
          : "";
        const lastDay = Array.isArray(analysis?.gdd_daily_values)
          ? analysis.gdd_daily_values.at(-1)
          : null;
        const tempInfo = lastDay && typeof lastDay === "object"
          ? `Dernier relevé : Tmax ${lastDay.tmax}°C · Tmin ${lastDay.tmin}°C · Dj ${lastDay.dj}°C`
          : "";
        const fields = [
          `Culture : ${analysis?.culture_detected ?? "—"}`,
          `Confiance : ${analysis?.confidence != null ? `${analysis.confidence}%` : "—"}`,
          `Verdict : ${analysis?.verdict ?? "—"}`,
          analysis?.details ? `Détails : ${analysis.details}` : "",
          analysis?.data_source ? `Source : ${analysis.data_source}` : "",
          gddInfo,
          tempInfo,
          analysis?.gdd_error ? `Confirmation Dj indisponible : ${analysis.gdd_error}` : "",
        ].filter(Boolean);
        detail.textContent = fields.join(" · ");
        content.append(title, detail);
        infoWindowRef.current?.setContent(content);
        if (event.latLng) {
          infoWindowRef.current?.setPosition(event.latLng);
          infoWindowRef.current?.open(map);
        }
      });

      polygon.addListener("mouseout", () => {
        polygon.setOptions({ fillOpacity: isBarley ? 0.42 : 0.12 });
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
