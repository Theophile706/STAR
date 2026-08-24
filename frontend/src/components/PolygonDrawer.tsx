import { useEffect, useRef, useState, useCallback } from "react";
import { Pencil, Trash2, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

interface PolygonDrawerProps {
  map: google.maps.Map | null;
  onPolygonComplete: (
    points: Array<{ lat: number; lng: number }>,
    ownerName: string,
    notes: string
  ) => void;
}

export default function PolygonDrawer({ map, onPolygonComplete }: PolygonDrawerProps) {
  const [drawing, setDrawing] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [ownerName, setOwnerName] = useState("");
  const [notes, setNotes] = useState("");
  const [pointCount, setPointCount] = useState(0);
  const pointsRef = useRef<Array<{ lat: number; lng: number }>>([]);
  const markersRef = useRef<google.maps.Marker[]>([]);
  const polylineRef = useRef<google.maps.Polyline | null>(null);
  const listenerRef = useRef<google.maps.MapsEventListener | null>(null);

  const cleanup = useCallback(() => {
    markersRef.current.forEach((m) => m.setMap(null));
    markersRef.current = [];
    polylineRef.current?.setMap(null);
    polylineRef.current = null;
    pointsRef.current = [];
    setPointCount(0);
  }, []);

  const updatePolyline = useCallback(() => {
    if (!map) return;
    polylineRef.current?.setMap(null);
    if (pointsRef.current.length > 1) {
      polylineRef.current = new google.maps.Polyline({
        path: pointsRef.current,
        strokeColor: "#ef4444",
        strokeWeight: 4,
        strokeOpacity: 1,
        map,
      });
    }
  }, [map]);

  const showFormStep = useCallback(() => {
    if (pointsRef.current.length < 3) return;
    if (listenerRef.current) {
      google.maps.event.removeListener(listenerRef.current);
      listenerRef.current = null;
    }
    if (map) map.setOptions({ draggableCursor: "" });
    setShowForm(true);
  }, [map]);

  const handleMapClick = useCallback(
    (e: google.maps.MapMouseEvent) => {
      if (!map || !e.latLng) return;
      const lat = e.latLng.lat();
      const lng = e.latLng.lng();

      pointsRef.current.push({ lat, lng });
      setPointCount(pointsRef.current.length);

      const marker = new google.maps.Marker({
        position: { lat, lng },
        map,
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          scale: 7,
          fillColor: "#ef4444",
          fillOpacity: 1,
          strokeColor: "#ffffff",
          strokeWeight: 3,
        },
      });
      markersRef.current.push(marker);
      updatePolyline();

      // Auto-close: if >= 3 points and clicking near the first point
      if (pointsRef.current.length >= 3) {
        const first = pointsRef.current[0];
        const p1 = new google.maps.LatLng(first.lat, first.lng);
        const dist = google.maps.geometry?.spherical?.computeDistanceBetween(p1, e.latLng);
        if (dist !== undefined && dist < 4) {
          showFormStep();
          return;
        }
      }

    },
    [map, updatePolyline, showFormStep]
  );

  const finishPolygon = useCallback(() => {
    if (pointsRef.current.length < 3) return;
    const pts = [...pointsRef.current];
    const name = ownerName.trim();
    const note = notes.trim();
    cleanup();
    setDrawing(false);
    setShowForm(false);
    setOwnerName("");
    setNotes("");
    onPolygonComplete(pts, name, note);
  }, [cleanup, onPolygonComplete, ownerName, notes]);

  const startDrawing = useCallback(() => {
    if (!map) return;
    cleanup();
    setDrawing(true);
    setShowForm(false);
    map.setOptions({ draggableCursor: "crosshair" });
    listenerRef.current = map.addListener("click", handleMapClick);
  }, [map, cleanup, handleMapClick]);

  const cancelDrawing = useCallback(() => {
    cleanup();
    setDrawing(false);
    setShowForm(false);
    setOwnerName("");
    setNotes("");
    if (listenerRef.current) {
      google.maps.event.removeListener(listenerRef.current);
      listenerRef.current = null;
    }
    if (map) map.setOptions({ draggableCursor: "" });
  }, [cleanup, map]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (listenerRef.current) {
        google.maps.event.removeListener(listenerRef.current);
      }
    };
  }, []);

  if (showForm) {
    return (
      <div className="absolute top-4 left-1/2 -translate-x-1/2 z-[800] analysis-popup p-4 w-80 space-y-3">
        <p className="text-sm font-semibold text-foreground">Informations de la parcelle</p>
        <Input
          placeholder="Nom du propriétaire"
          value={ownerName}
          onChange={(e) => setOwnerName(e.target.value)}
          className="bg-background/50 text-sm h-9"
        />
        <Textarea
          placeholder="Notes sur la parcelle..."
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          className="bg-background/50 text-sm min-h-[60px]"
        />
        <div className="flex gap-2">
          <Button onClick={finishPolygon} size="sm" className="flex-1 gap-2">
            <Check className="w-4 h-4" />
            Analyser ({pointCount} pts)
          </Button>
          <Button onClick={cancelDrawing} size="sm" variant="outline" className="gap-2">
            <Trash2 className="w-4 h-4" />
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="absolute top-4 left-1/2 -translate-x-1/2 z-[800] flex gap-2">
      {!drawing ? (
        <Button
          onClick={startDrawing}
          size="sm"
          className="gap-2 analysis-popup border-0 bg-card/95 text-foreground hover:bg-muted"
        >
          <Pencil className="w-4 h-4 text-primary" />
          Tracer une parcelle
        </Button>
      ) : (
        <>
          <Button
            onClick={showFormStep}
            size="sm"
            variant="default"
            className="gap-2"
            disabled={pointCount < 3}
          >
            <Check className="w-4 h-4" />
            Valider ({pointCount} pts)
          </Button>
          <Button onClick={cancelDrawing} size="sm" variant="outline" className="gap-2">
            <Trash2 className="w-4 h-4" />
            Annuler
          </Button>
        </>
      )}
    </div>
  );
}
