import { useEffect } from "react";
import { buildSentinel2TileUrlTemplate } from "@/lib/barley-detect-simple";

interface Sentinel2TileLayerProps {
  map: google.maps.Map | null;
  imageTimestampMs: number;
}

const SENTINEL2_MIN_ZOOM = 10; // en dessous, la tuile couvre une zone plus grande qu'une scène Sentinel-2 : le roadmap Google suffit.
const SENTINEL2_MAX_ZOOM = 17; // résolution native Sentinel-2 ~10 m/pixel : au-delà, les tuiles ne gagnent plus en détail.

/**
 * Superpose l'image Sentinel-2 EXACTE utilisée par une analyse en cours, uniquement sur la zone
 * recherchée — pas un fond de carte permanent (pan/zoom libre sur toute la carte). Le monteur
 * (SatelliteMap) ne rend ce composant que lorsqu'un résultat d'analyse Sentinel-2 est disponible.
 */
export default function Sentinel2TileLayer({ map, imageTimestampMs }: Sentinel2TileLayerProps) {
  useEffect(() => {
    if (!map) return;

    const urlTemplate = buildSentinel2TileUrlTemplate(imageTimestampMs);
    const tileLayer = new google.maps.ImageMapType({
      // ImageMapType.minZoom/maxZoom ne suffisent pas à eux seuls : Google Maps continue
      // d'appeler getTileUrl en dehors de cette plage (vérifié en conditions réelles). Sans ce
      // garde-fou explicite, une tuile Sentinel-2 quasi vide (une seule scène S2 ~110km ne
      // couvre qu'une fraction d'une tuile à faible zoom) se superposait au roadmap et cassait
      // son rendu propre. Retourner null ici laisse Google Maps afficher le roadmap seul.
      getTileUrl: (coord, zoom) => {
        if (zoom < SENTINEL2_MIN_ZOOM || zoom > SENTINEL2_MAX_ZOOM) return null;
        return urlTemplate
          .replace("{z}", String(zoom))
          .replace("{x}", String(coord.x))
          .replace("{y}", String(coord.y));
      },
      tileSize: new google.maps.Size(256, 256),
      minZoom: SENTINEL2_MIN_ZOOM,
      maxZoom: SENTINEL2_MAX_ZOOM,
      name: "Sentinel-2",
    });
    map.overlayMapTypes.push(tileLayer);

    return () => {
      const index = map.overlayMapTypes.getArray().indexOf(tileLayer);
      if (index !== -1) map.overlayMapTypes.removeAt(index);
    };
  }, [map, imageTimestampMs]);

  return null;
}
