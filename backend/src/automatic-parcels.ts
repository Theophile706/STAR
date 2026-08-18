import { analyzeParcel } from "./analyze-parcel.js";
import { Prisma, PrismaClient } from "@prisma/client";

export interface BarleyDetectionConfig {
  baseTemperature: number;
  threshold: number;
  periodDays: number;
}

export interface AutoDetectionRequest extends BarleyDetectionConfig {
  lat: number;
  lng: number;
  radiusKm: number;
}

interface CandidateParcel {
  id: string;
  coordinates: Array<{ lat: number; lng: number }>;
  center: { lat: number; lng: number };
  tags: Record<string, string>;
  persist?: boolean;
}

export interface AutoDetectedParcel extends CandidateParcel {
  analysis: Record<string, unknown> | null;
  analysis_error: string | null;
}

export interface AutoDetectionResponse {
  center: { lat: number; lng: number };
  radius_km: number;
  base_temperature: number;
  threshold: number;
  period_days: number;
  candidates_found: number;
  analyzed_count: number;
  parcels: AutoDetectedParcel[];
  notice: string | null;
}

const OVERPASS_API_URLS = [
  process.env.OVERPASS_API_URL ?? "https://overpass-api.de/api/interpreter",
  "https://overpass.openstreetmap.fr/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];
const OVERPASS_USER_AGENT = process.env.OVERPASS_USER_AGENT ?? "fieldscan-ai/1.0 (+https://localhost)";
const MAX_CANDIDATES = 48;
const MAX_SATELLITE_CELLS = 36;
const ANALYSIS_CONCURRENCY = 2;
const AUTOMATIC_SEGMENT_LABEL_PREFIX = "automatic-orge-segment:";
const prisma = new PrismaClient();

// ── Segmentation automatique des limites de parcelles (image satellite) ──
const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY;
const FIELD_SEGMENTATION_MODEL_URL = process.env.FIELD_SEGMENTATION_MODEL_URL;
const SEGMENTATION_IMAGE_SIZE = 640;
const SEGMENTATION_MARGIN_FACTOR = 1.3;
// Au-delà de ce rayon, la résolution d'une image 640x640 devient trop grossière
// pour distinguer des limites de champs individuelles : on repasse sur la grille.
const MAX_SEGMENTATION_RADIUS_KM = 3;
const SEGMENTATION_MIN_POLYGON_AREA_M2 = 200;

type OverpassElement = {
  type?: string;
  id?: number;
  geometry?: Array<{ lat?: number; lon?: number }>;
  tags?: Record<string, string>;
};

export async function detectAutomaticParcels({ lat, lng, radiusKm, baseTemperature, threshold, periodDays }: AutoDetectionRequest): Promise<AutoDetectionResponse> {
  try {
    const candidates = await discoverAgriculturalParcels(lat, lng, radiusKm);
    const config = { baseTemperature, threshold, periodDays };
    const analyzedCandidates = candidates.slice(0, MAX_CANDIDATES);
    const segmentationFallback = analyzedCandidates.some((candidate) => candidate.tags.source === "satellite-segmentation");
    const satelliteWindowFallback = !segmentationFallback && analyzedCandidates.some((candidate) => candidate.tags.source?.startsWith("satellite-search"));
    const analyzedParcels = await mapWithConcurrency(analyzedCandidates, ANALYSIS_CONCURRENCY, (candidate) => analyzeCandidate(candidate, config));
    const analyzedIds = new Set(analyzedCandidates.map((candidate) => candidate.id));
    const parcels = [
      ...analyzedParcels,
      ...candidates
        .filter((candidate) => !analyzedIds.has(candidate.id))
        .map((candidate) => ({
          ...candidate,
          analysis: null,
          analysis_error: "Analyse IA non exécutée pour cette parcelle.",
        })),
    ];

    return {
      center: { lat, lng },
      radius_km: radiusKm,
      base_temperature: baseTemperature,
      threshold,
      period_days: periodDays,
      candidates_found: candidates.length,
      analyzed_count: parcels.filter((parcel) => parcel.analysis !== null).length,
      parcels,
      notice: segmentationFallback
        ? "Aucun contour vectoriel référencé : les limites de parcelles ont été détectées automatiquement par segmentation d’image satellite (IA)."
        : satelliteWindowFallback
          ? "Aucun contour vectoriel n’a été trouvé : plusieurs cellules satellite autour du point sont analysées sans créer de fausse parcelle en base."
          : candidates.length === 0
            ? "Aucun contour agricole fiable n’est référencé dans ce rayon."
            : null,
    };
  } catch (error) {
    // On erreur (DB, Overpass, etc.) renvoyer un fallback lisible pour le frontend
    console.warn("detectAutomaticParcels: discovery/analysis failure:", error);
    const message = error instanceof Error ? error.message : "Service de découverte indisponible.";
    return {
      center: { lat, lng },
      radius_km: radiusKm,
      base_temperature: baseTemperature,
      threshold,
      period_days: periodDays,
      candidates_found: 0,
      analyzed_count: 0,
      parcels: [],
      notice: message.includes("Database") || message.toLowerCase().includes("parcelles") || message.toLowerCase().includes("database")
        ? "La base des parcelles agricoles est indisponible. Essayez un rayon plus large ou vérifiez la configuration de la base de données."
        : message,
    };
  }
}

async function discoverAgriculturalParcels(lat: number, lng: number, radiusKm: number): Promise<CandidateParcel[]> {
  const candidates = await discoverAgriculturalParcelsFromOverpass(lat, lng, radiusKm);
  if (candidates.length > 0) return ensureCoordinateCoverage(candidates, lat, lng, radiusKm);

  const databaseCandidates = await discoverAgriculturalParcelsFromDatabase(lat, lng, radiusKm);
  if (databaseCandidates.length > 0) return ensureCoordinateCoverage(databaseCandidates, lat, lng, radiusKm);

  try {
    const segmentedCandidates = await discoverAgriculturalParcelsFromSegmentation(lat, lng, radiusKm);
    if (segmentedCandidates.length > 0) return ensureCoordinateCoverage(segmentedCandidates, lat, lng, radiusKm);
  } catch (error) {
    console.warn("discoverAgriculturalParcelsFromSegmentation failed, falling back to grid:", error);
  }

  return createSatelliteSearchCellCandidates(lat, lng, radiusKm);
}

function ensureCoordinateCoverage(candidates: CandidateParcel[], lat: number, lng: number, radiusKm: number): CandidateParcel[] {
  const constrainedCandidates = candidates.flatMap((candidate) => {
    const coordinates = clipPolygonToRadius(candidate.coordinates, { lat, lng }, radiusKm);
    if (coordinates.length < 3) return [];
    return [{ ...candidate, coordinates, center: polygonCenter(coordinates) }];
  });
  const satelliteCells = createSatelliteSearchCellCandidates(lat, lng, radiusKm)
    .filter((cell) => !constrainedCandidates.some((candidate) => pointInPolygon(cell.center, candidate.coordinates)));
  return [...constrainedCandidates, ...satelliteCells].slice(0, MAX_CANDIDATES);
}

function createSatelliteSearchCellCandidates(lat: number, lng: number, radiusKm: number): CandidateParcel[] {
  const center = { lat, lng };
  const cellSizeKm = Math.max(0.1, radiusKm / Math.sqrt(MAX_SATELLITE_CELLS / Math.PI));
  const halfCellKm = cellSizeKm / 2;
  const cellCount = Math.ceil(radiusKm / cellSizeKm);
  const cells: CandidateParcel[] = [];

  for (let row = -cellCount; row <= cellCount; row++) {
    for (let column = -cellCount; column <= cellCount; column++) {
      const cellCenter = offsetPoint(center, column * cellSizeKm, row * cellSizeKm);
      if (distanceBetweenPoints(center, cellCenter) > radiusKm + halfCellKm) continue;
      const cell = squareAround(cellCenter, halfCellKm);
      const coordinates = clipPolygonToRadius(cell, center, radiusKm);
      if (coordinates.length < 3) continue;
      cells.push({
        id: `satellite-search-cell-${lat.toFixed(6)}-${lng.toFixed(6)}-${row}-${column}`,
        coordinates,
        center: polygonCenter(coordinates),
        tags: { source: "satellite-search-cell" },
        persist: false,
      });
    }
  }

  return cells
    .sort((left, right) => distanceBetweenPoints(center, left.center) - distanceBetweenPoints(center, right.center))
    .slice(0, MAX_SATELLITE_CELLS);
}

// ── Web Mercator : conversion pixel image <-> lat/lng (même projection que les tuiles Google Maps) ──
const WORLD_TILE_SIZE = 256;

function latLngToWorldPoint(lat: number, lng: number): { x: number; y: number } {
  const sinY = Math.min(Math.max(Math.sin((lat * Math.PI) / 180), -0.9999), 0.9999);
  return {
    x: WORLD_TILE_SIZE * (0.5 + lng / 360),
    y: WORLD_TILE_SIZE * (0.5 - Math.log((1 + sinY) / (1 - sinY)) / (4 * Math.PI)),
  };
}

function worldPointToLatLng(x: number, y: number): { lat: number; lng: number } {
  const lng = (x / WORLD_TILE_SIZE - 0.5) * 360;
  const n = Math.PI - (2 * Math.PI * y) / WORLD_TILE_SIZE;
  const lat = (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
  return { lat, lng };
}

/** Convertit un pixel (origine en haut à gauche) d'une image Static Maps en lat/lng. */
function pixelToLatLng(
  px: number,
  py: number,
  center: { lat: number; lng: number },
  zoom: number,
  imageWidthPx: number,
  imageHeightPx: number,
): { lat: number; lng: number } {
  const scale = 2 ** zoom;
  const centerWorld = latLngToWorldPoint(center.lat, center.lng);
  const centerPixel = { x: centerWorld.x * scale, y: centerWorld.y * scale };
  const originPixel = { x: centerPixel.x - imageWidthPx / 2, y: centerPixel.y - imageHeightPx / 2 };
  const worldX = (originPixel.x + px) / scale;
  const worldY = (originPixel.y + py) / scale;
  return worldPointToLatLng(worldX, worldY);
}

/** Zoom Static Maps le plus élevé qui garde le disque de rayon radiusKm dans l'image. */
function zoomToFitRadius(lat: number, radiusKm: number, imageSizePx: number): number {
  const diameterMeters = 2 * radiusKm * 1000 * SEGMENTATION_MARGIN_FACTOR;
  const metersPerPixelAtZoom0 = 156_543.03392 * Math.cos((lat * Math.PI) / 180);
  const rawZoom = Math.log2((metersPerPixelAtZoom0 * imageSizePx) / diameterMeters);
  return Math.min(20, Math.max(1, Math.floor(rawZoom)));
}

function polygonAreaM2(polygon: Array<{ lat: number; lng: number }>): number {
  if (polygon.length < 3) return 0;
  const longitudeScale = Math.max(Math.abs(Math.cos((polygon[0].lat * Math.PI) / 180)), 0.1);
  const toMeters = (point: { lat: number; lng: number }) => ({
    x: point.lng * 111_320 * longitudeScale,
    y: point.lat * 110_574,
  });
  const points = polygon.map(toMeters);
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) / 2;
}

async function fetchSatelliteImageBase64(
  lat: number,
  lng: number,
  zoom: number,
  sizePx: number,
): Promise<string> {
  if (!GOOGLE_MAPS_API_KEY || GOOGLE_MAPS_API_KEY.startsWith("VOTRE_")) {
    throw new Error("GOOGLE_MAPS_API_KEY n’est pas configurée.");
  }
  const params = new URLSearchParams({
    center: `${lat},${lng}`,
    zoom: String(zoom),
    size: `${sizePx}x${sizePx}`,
    maptype: "satellite",
    key: GOOGLE_MAPS_API_KEY,
  });
  const response = await fetch(`https://maps.googleapis.com/maps/api/staticmap?${params.toString()}`, {
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`Google Maps Static API error: ${response.status}`);
  const arrayBuffer = await response.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

interface SegmentationPolygonResponse {
  /** Coordonnées en pixels, origine en haut à gauche de l'image envoyée. */
  points: Array<{ x: number; y: number }>;
  score?: number;
  label?: string;
}

interface SegmentationModelResponse {
  polygons: SegmentationPolygonResponse[];
  image_width?: number;
  image_height?: number;
}

/**
 * Appelle un modèle externe de segmentation de champs (ex: un Space HF basé sur
 * SAM / un modèle de délinéation parcellaire) sur une image satellite statique,
 * puis géoréférence les polygones retournés (en pixels) vers des lat/lng.
 *
 * Contrat attendu côté modèle : POST multipart "file" -> image satellite (PNG/JPEG),
 * réponse JSON { polygons: [{ points: [{x,y}, ...], score?, label? }, ...] }
 * avec des coordonnées pixels dans le repère de l'image envoyée (haut-gauche = origine).
 */
async function callFieldSegmentationModel(imageBase64: string): Promise<SegmentationModelResponse> {
  const binaryStr = atob(imageBase64);
  const bytes = new Uint8Array(binaryStr.length);
  for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);

  const formData = new FormData();
  formData.append("file", new Blob([bytes], { type: "image/png" }), "parcel-area.png");

  const response = await fetch(`${FIELD_SEGMENTATION_MODEL_URL}/segment`, {
    method: "POST",
    body: formData,
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Modèle de segmentation : erreur ${response.status} ${text.slice(0, 300)}`);
  }
  const data: unknown = await response.json();
  if (!data || typeof data !== "object" || !Array.isArray((data as Record<string, unknown>).polygons)) {
    throw new Error("Réponse du modèle de segmentation invalide (champ 'polygons' manquant).");
  }
  return data as SegmentationModelResponse;
}

async function discoverAgriculturalParcelsFromSegmentation(
  lat: number,
  lng: number,
  radiusKm: number,
): Promise<CandidateParcel[]> {
  if (!FIELD_SEGMENTATION_MODEL_URL) return [];
  if (radiusKm > MAX_SEGMENTATION_RADIUS_KM) return [];

  const zoom = zoomToFitRadius(lat, radiusKm, SEGMENTATION_IMAGE_SIZE);
  const imageBase64 = await fetchSatelliteImageBase64(lat, lng, zoom, SEGMENTATION_IMAGE_SIZE);
  const result = await callFieldSegmentationModel(imageBase64);
  const imageWidth = result.image_width ?? SEGMENTATION_IMAGE_SIZE;
  const imageHeight = result.image_height ?? SEGMENTATION_IMAGE_SIZE;
  const center = { lat, lng };

  return result.polygons.flatMap((polygon, index): CandidateParcel[] => {
    if (!Array.isArray(polygon.points) || polygon.points.length < 3) return [];
    const coordinates = polygon.points.flatMap((point) => {
      if (typeof point.x !== "number" || typeof point.y !== "number") return [];
      return [pixelToLatLng(point.x, point.y, center, zoom, imageWidth, imageHeight)];
    });
    if (coordinates.length < 3) return [];
    if (polygonAreaM2(coordinates) < SEGMENTATION_MIN_POLYGON_AREA_M2) return [];
    return [{
      id: `segmentation-${lat.toFixed(6)}-${lng.toFixed(6)}-${index}`,
      coordinates,
      center: polygonCenter(coordinates),
      tags: {
        source: "satellite-segmentation",
        ...(polygon.label ? { crop_hint: polygon.label } : {}),
        ...(typeof polygon.score === "number" ? { segmentation_score: String(polygon.score) } : {}),
      },
    }];
  });
}

async function discoverAgriculturalParcelsFromOverpass(lat: number, lng: number, radiusKm: number): Promise<CandidateParcel[]> {
  const query = `[out:json][timeout:20];(way["landuse"~"farmland|farm|orchard|vineyard|meadow"](around:${radiusKm * 1000},${lat},${lng});relation["landuse"~"farmland|farm|orchard|vineyard|meadow"](around:${radiusKm * 1000},${lat},${lng});way["crop"](around:${radiusKm * 1000},${lat},${lng});relation["crop"](around:${radiusKm * 1000},${lat},${lng}););out tags geom;`;
  for (const endpoint of [...new Set(OVERPASS_API_URLS)]) {
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": OVERPASS_USER_AGENT,
        },
        body: new URLSearchParams({ data: query }),
        signal: AbortSignal.timeout(25_000),
      });
      if (!response.ok) {
        const text = await response.text().catch(() => "");
        console.warn(`Overpass endpoint ${endpoint} returned ${response.status}: ${text}`);
        continue;
      }
      const payload: unknown = await response.json();
      const candidateElements = payload && typeof payload === "object" && "elements" in payload ? payload.elements : null;
      if (!Array.isArray(candidateElements)) continue;
      const parsed = candidateElements.flatMap((element): CandidateParcel[] => {
        if (!element || typeof element !== "object") return [];
        const item = element as OverpassElement;
        if (item.type !== "way" || typeof item.id !== "number" || !Array.isArray(item.geometry)) return [];
        const coordinates = item.geometry.flatMap((point) => {
          if (typeof point.lat !== "number" || typeof point.lon !== "number") return [];
          return [{ lat: point.lat, lng: point.lon }];
        });
        if (coordinates.length < 3) return [];
        const first = coordinates[0];
        const last = coordinates.at(-1);
        const closedCoordinates = last && first.lat === last.lat && first.lng === last.lng ? coordinates.slice(0, -1) : coordinates;
        if (closedCoordinates.length < 3) return [];
        const center = {
          lat: closedCoordinates.reduce((sum, point) => sum + point.lat, 0) / closedCoordinates.length,
          lng: closedCoordinates.reduce((sum, point) => sum + point.lng, 0) / closedCoordinates.length,
        };
        return [{ id: `osm-way-${item.id}`, coordinates: closedCoordinates, center, tags: item.tags ?? {} }];
      });
      const candidates = parsed.filter((candidate) => isParcelWithinRadius(candidate, { lat, lng }, radiusKm));
      if (candidates.length > 0) return candidates;
    } catch {
      continue;
    }
  }
  return [];
}

async function discoverAgriculturalParcelsFromDatabase(lat: number, lng: number, radiusKm: number): Promise<CandidateParcel[]> {
  const latDelta = radiusKm / 110.574;
  const longitudeScale = Math.max(Math.abs(Math.cos((lat * Math.PI) / 180)), 0.1);
  const lngDelta = radiusKm / (111.32 * longitudeScale);
  const minLat = lat - latDelta;
  const maxLat = lat + latDelta;
  const minLng = lng - lngDelta;
  const maxLng = lng + lngDelta;

  let rows;
  try {
    rows = await prisma.parcelle.findMany({
      where: {
        center_lat: { gte: minLat, lte: maxLat },
        center_lng: { gte: minLng, lte: maxLng },
        NOT: { label: { startsWith: AUTOMATIC_SEGMENT_LABEL_PREFIX } },
      },
    });
  } catch (error) {
    console.error("Database access error for parcel discovery:", error);
    return [];
  }

  return rows.flatMap((row) => {
    const coordinates = Array.isArray(row.coordinates)
      ? row.coordinates.flatMap((point) => {
          if (!point || typeof point !== "object") return [];
          const values = point as Record<string, unknown>;
          const latValue = values.lat;
          const lngValue = values.lng;
          if (typeof latValue !== "number" || typeof lngValue !== "number") return [];
          return [{ lat: latValue, lng: lngValue }];
        })
      : [];
    if (coordinates.length < 3) return [];
    const center = {
      lat: coordinates.reduce((sum, point) => sum + point.lat, 0) / coordinates.length,
      lng: coordinates.reduce((sum, point) => sum + point.lng, 0) / coordinates.length,
    };
    const candidate = { id: row.id, coordinates, center, tags: {} };
    return isParcelWithinRadius(candidate, { lat, lng }, radiusKm) ? [candidate] : [];
  });
}

interface GrowingDegreeDaySummary {
  cumulative: number;
  detected: boolean;
  startDate: string;
  endDate: string;
  dailyValues: Array<{ date: string; tmax: number; tmin: number; dj: number }>;
}

function pointInPolygon(point: { lat: number; lng: number }, polygon: Array<{ lat: number; lng: number }>): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].lng;
    const yi = polygon[i].lat;
    const xj = polygon[j].lng;
    const yj = polygon[j].lat;
    const intersect = (yi > point.lat) !== (yj > point.lat)
      && point.lng < ((xj - xi) * (point.lat - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function distanceToSegment(point: { x: number; y: number }, start: { x: number; y: number }, end: { x: number; y: number }): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return Math.hypot(point.x - start.x, point.y - start.y);
  const ratio = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared));
  return Math.hypot(point.x - (start.x + ratio * dx), point.y - (start.y + ratio * dy));
}

function polygonCenter(points: Array<{ lat: number; lng: number }>): { lat: number; lng: number } {
  return {
    lat: points.reduce((sum, point) => sum + point.lat, 0) / points.length,
    lng: points.reduce((sum, point) => sum + point.lng, 0) / points.length,
  };
}

function offsetPoint(center: { lat: number; lng: number }, eastKm: number, northKm: number): { lat: number; lng: number } {
  const longitudeScale = Math.max(Math.abs(Math.cos((center.lat * Math.PI) / 180)), 0.1);
  return {
    lat: center.lat + northKm / 110.574,
    lng: center.lng + eastKm / (111.32 * longitudeScale),
  };
}

function distanceBetweenPoints(left: { lat: number; lng: number }, right: { lat: number; lng: number }): number {
  const longitudeScale = Math.max(Math.abs(Math.cos((left.lat * Math.PI) / 180)), 0.1);
  const eastKm = (right.lng - left.lng) * 111.32 * longitudeScale;
  const northKm = (right.lat - left.lat) * 110.574;
  return Math.hypot(eastKm, northKm);
}

function squareAround(center: { lat: number; lng: number }, halfSideKm: number): Array<{ lat: number; lng: number }> {
  return [
    offsetPoint(center, -halfSideKm, -halfSideKm),
    offsetPoint(center, halfSideKm, -halfSideKm),
    offsetPoint(center, halfSideKm, halfSideKm),
    offsetPoint(center, -halfSideKm, halfSideKm),
  ];
}

function radiusPolygon(center: { lat: number; lng: number }, radiusKm: number): Array<{ lat: number; lng: number }> {
  const radiusM = radiusKm * 1_000;
  const longitudeScale = Math.max(Math.abs(Math.cos((center.lat * Math.PI) / 180)), 0.1);
  return Array.from({ length: 48 }, (_, index) => {
    const angle = (index / 48) * Math.PI * 2;
    return {
      lat: center.lat + (Math.sin(angle) * radiusM) / 110_574,
      lng: center.lng + (Math.cos(angle) * radiusM) / (111_320 * longitudeScale),
    };
  });
}

type LocalPoint = { x: number; y: number };

function clipPolygonToRadius(
  polygon: Array<{ lat: number; lng: number }>,
  center: { lat: number; lng: number },
  radiusKm: number,
): Array<{ lat: number; lng: number }> {
  const longitudeScale = Math.max(Math.abs(Math.cos((center.lat * Math.PI) / 180)), 0.1);
  const toLocal = (point: { lat: number; lng: number }): LocalPoint => ({
    x: (point.lng - center.lng) * 111_320 * longitudeScale,
    y: (point.lat - center.lat) * 110_574,
  });
  const fromLocal = (point: LocalPoint) => ({
    lat: center.lat + point.y / 110_574,
    lng: center.lng + point.x / (111_320 * longitudeScale),
  });
  const points = polygon.slice();
  const first = points[0];
  const last = points.at(-1);
  if (first && last && first.lat === last.lat && first.lng === last.lng) points.pop();
  let clipped = points.map(toLocal);
  const boundary = radiusPolygon(center, radiusKm).map(toLocal);

  for (let index = 0; index < boundary.length && clipped.length > 0; index++) {
    const start = boundary[index];
    const end = boundary[(index + 1) % boundary.length];
    const input = clipped;
    clipped = [];
    for (let pointIndex = 0; pointIndex < input.length; pointIndex++) {
      const previous = input[(pointIndex + input.length - 1) % input.length];
      const current = input[pointIndex];
      const previousInside = crossProduct(start, end, previous) >= 0;
      const currentInside = crossProduct(start, end, current) >= 0;
      if (currentInside !== previousInside) clipped.push(lineIntersection(previous, current, start, end));
      if (currentInside) clipped.push(current);
    }
  }

  return clipped.map(fromLocal);
}

function crossProduct(start: LocalPoint, end: LocalPoint, point: LocalPoint): number {
  return (end.x - start.x) * (point.y - start.y) - (end.y - start.y) * (point.x - start.x);
}

function lineIntersection(start: LocalPoint, end: LocalPoint, boundaryStart: LocalPoint, boundaryEnd: LocalPoint): LocalPoint {
  const direction = { x: end.x - start.x, y: end.y - start.y };
  const boundaryDirection = { x: boundaryEnd.x - boundaryStart.x, y: boundaryEnd.y - boundaryStart.y };
  const denominator = direction.x * boundaryDirection.y - direction.y * boundaryDirection.x;
  if (denominator === 0) return end;
  const offset = { x: boundaryStart.x - start.x, y: boundaryStart.y - start.y };
  const ratio = (offset.x * boundaryDirection.y - offset.y * boundaryDirection.x) / denominator;
  return { x: start.x + ratio * direction.x, y: start.y + ratio * direction.y };
}

function isParcelWithinRadius(candidate: CandidateParcel, center: { lat: number; lng: number }, radiusKm: number): boolean {
  if (pointInPolygon(center, candidate.coordinates)) return true;
  const longitudeScale = Math.cos((center.lat * Math.PI) / 180);
  const toKilometers = (point: { lat: number; lng: number }) => ({
    x: (point.lng - center.lng) * 111.32 * longitudeScale,
    y: (point.lat - center.lat) * 110.574,
  });
  const origin = { x: 0, y: 0 };
  const points = candidate.coordinates.map(toKilometers);
  return points.some((point) => Math.hypot(point.x, point.y) <= radiusKm)
    || points.some((point, index) => distanceToSegment(origin, point, points[(index + 1) % points.length]) <= radiusKm);
}

async function analyzeCandidate(candidate: CandidateParcel, config: BarleyDetectionConfig): Promise<AutoDetectedParcel> {
  let response: Response;
  try {
    response = await analyzeParcel(new Request("http://backend/auto-analyze-parcel", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        lat: candidate.center.lat,
        lng: candidate.center.lng,
        zoom: 15,
        polygon: candidate.coordinates,
      }),
    }));
  } catch (error) {
    return {
      ...candidate,
      analysis: null,
      analysis_error: error instanceof Error ? error.message : "Analyse satellite indisponible.",
    };
  }

  const body = await response.text();
  let data: unknown = null;
  try {
    data = JSON.parse(body);
  } catch {
    data = null;
  }
  if (!response.ok || !data || typeof data !== "object") {
    return { ...candidate, analysis: null, analysis_error: "Analyse satellite indisponible." };
  }

  // Le cumul de degrés-jours ne fait que confirmer une détection déjà positive.
  // Une panne/limite de débit ponctuelle sur Open-Meteo ne doit pas faire disparaître
  // un résultat satellite/HF valide (la parcelle reste "probable" au lieu d'être perdue).
  let gdd: GrowingDegreeDaySummary | null = null;
  let gddError: string | null = null;
  try {
    gdd = await fetchGrowingDegreeDays(candidate.center.lat, candidate.center.lng, config);
  } catch (error) {
    gddError = error instanceof Error ? error.message : "Données degrés-jours indisponibles.";
  }

  const modelAnalysis = data as Record<string, unknown>;
  const modelDetectsBarley = modelAnalysis.is_barley === true;
  const barleyPresence = modelDetectsBarley
    ? gdd?.detected === true ? "confirmed" : "probable"
    : "none";
  const analysis = {
    ...modelAnalysis,
    barley_presence: barleyPresence,
    gdd_cumulative: gdd?.cumulative,
    gdd_threshold: config.threshold,
    gdd_base_temperature: config.baseTemperature,
    gdd_start_date: gdd?.startDate,
    gdd_end_date: gdd?.endDate,
    gdd_detected: gdd?.detected,
    gdd_daily_values: gdd?.dailyValues,
    gdd_error: gddError,
  };

  if (candidate.persist !== false) {
    try {
      await saveAutomaticAnalysis(candidate, analysis);
    } catch (error) {
      console.warn(`Automatic analysis ${candidate.id} was not persisted:`, error);
    }
  }

  return { ...candidate, analysis, analysis_error: null };
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

async function saveAutomaticAnalysis(candidate: CandidateParcel, analysis: Record<string, unknown>): Promise<void> {
  const gddSummary = asNumber(analysis.gdd_cumulative) != null && asNumber(analysis.gdd_threshold) != null
    ? `Degrés-jours : ${analysis.gdd_cumulative}/${analysis.gdd_threshold} °C`
    : "";
  const lastDay = Array.isArray(analysis.gdd_daily_values) ? analysis.gdd_daily_values.at(-1) : null;
  const temperatureSummary = lastDay && typeof lastDay === "object"
    ? `Dernier relevé : Tmax ${String((lastDay as Record<string, unknown>).tmax ?? "—")}°C · Tmin ${String((lastDay as Record<string, unknown>).tmin ?? "—")}°C`
    : "";
  const details = [asString(analysis.details), gddSummary, temperatureSummary].filter(Boolean).join(" · ") || null;
  const recommendations = [asString(analysis.recommendations), asString(analysis.details), gddSummary, temperatureSummary].filter(Boolean).join(" · ") || null;
  const data: Prisma.ParcelleUncheckedCreateInput = {
    label: candidate.id,
    coordinates: candidate.coordinates,
    center_lat: candidate.center.lat,
    center_lng: candidate.center.lng,
    surface_ha: null,
    culture_declared: asString(analysis.culture_declared),
    culture_detected: asString(analysis.culture_detected),
    ndvi_percentage: asNumber(analysis.percentage),
    confidence: asNumber(analysis.confidence),
    verdict: asString(analysis.verdict),
    details,
    saison: asString(analysis.saison),
    soil_type: asString(analysis.soil_type),
    risk_factors: asStringArray(analysis.risk_factors),
    recommendations,
    data_source: asString(analysis.data_source),
    owner_name: asString(candidate.tags.owner),
    notes: null,
    time_series_s1: Array.isArray(analysis.time_series_s1) ? analysis.time_series_s1 : [],
    time_series_s2: Array.isArray(analysis.time_series_s2) ? analysis.time_series_s2 : [],
    estimated_planting_date: asString(analysis.estimated_planting_date),
    estimated_harvest_date: asString(analysis.estimated_harvest_date),
    days_since_planting: Number.isInteger(analysis.days_since_planting) ? analysis.days_since_planting as number : null,
    growth_stage: asString(analysis.growth_stage),
    planting_confidence: asNumber(analysis.planting_confidence),
    evi: asNumber(analysis.evi),
    savi: asNumber(analysis.savi),
    ndwi: asNumber(analysis.ndwi),
    agro_score: asNumber(analysis.agro_score),
    hybrid_score: asNumber(analysis.hybrid_score),
    cnn_prob_barley: asNumber(analysis.cnn_prob_barley),
    cnn_prob_non_barley: asNumber(analysis.cnn_prob_non_barley),
  };
  const existing = await prisma.parcelle.findFirst({ where: { label: candidate.id }, select: { id: true } });
  if (existing) {
    await prisma.parcelle.update({ where: { id: existing.id }, data });
  } else {
    await prisma.parcelle.create({ data });
  }

  await saveDetectedBarleySegments(candidate, analysis);
}

async function saveDetectedBarleySegments(candidate: CandidateParcel, analysis: Record<string, unknown>): Promise<void> {
  const labelPrefix = `${AUTOMATIC_SEGMENT_LABEL_PREFIX}${candidate.id}:`;
  await prisma.parcelle.deleteMany({ where: { label: { startsWith: labelPrefix } } });

  const rawSegments = Array.isArray(analysis.detected_segments) ? analysis.detected_segments : [];
  for (const [index, rawSegment] of rawSegments.entries()) {
    if (!rawSegment || typeof rawSegment !== "object") continue;
    const segment = rawSegment as Record<string, unknown>;
    const coordinates = asCoordinateArray(segment.coordinates);
    const confidence = asNumber(segment.confidence);
    const areaHa = asNumber(segment.area_ha);
    if (!coordinates || confidence == null || areaHa == null) continue;

    const ndvi = asNumber(segment.ndvi);
    const ndviPercentage = ndvi == null ? null : Math.round(ndvi * 1000) / 10;
    const label = `${labelPrefix}${index}`;
    const data: Prisma.ParcelleUncheckedCreateInput = {
      label,
      coordinates,
      center_lat: coordinates.reduce((sum, point) => sum + point.lat, 0) / coordinates.length,
      center_lng: coordinates.reduce((sum, point) => sum + point.lng, 0) / coordinates.length,
      surface_ha: areaHa,
      culture_declared: asString(analysis.culture_declared),
      culture_detected: "Orge",
      ndvi_percentage: ndviPercentage,
      confidence,
      verdict: "CONFORME",
      details: `Segment d’orge détecté automatiquement (${confidence}%).`,
      saison: asString(analysis.saison),
      soil_type: asString(analysis.soil_type),
      risk_factors: asStringArray(analysis.risk_factors),
      recommendations: asString(analysis.recommendations),
      data_source: `${asString(analysis.data_source) ?? "Analyse automatique"} + Segmentation d’orge`,
      owner_name: asString(candidate.tags.owner) ?? "Orge détectée",
      notes: "Contour d’orge détecté automatiquement.",
      time_series_s1: Array.isArray(analysis.time_series_s1) ? analysis.time_series_s1 : [],
      time_series_s2: Array.isArray(analysis.time_series_s2) ? analysis.time_series_s2 : [],
      estimated_planting_date: asString(analysis.estimated_planting_date),
      estimated_harvest_date: asString(analysis.estimated_harvest_date),
      days_since_planting: Number.isInteger(analysis.days_since_planting) ? analysis.days_since_planting as number : null,
      growth_stage: asString(analysis.growth_stage),
      planting_confidence: asNumber(analysis.planting_confidence),
      evi: asNumber(analysis.evi),
      savi: asNumber(analysis.savi),
      ndwi: asNumber(analysis.ndwi),
      agro_score: asNumber(analysis.agro_score),
      hybrid_score: asNumber(analysis.hybrid_score),
      cnn_prob_barley: asNumber(analysis.cnn_prob_barley),
      cnn_prob_non_barley: asNumber(analysis.cnn_prob_non_barley),
    };

    const existing = await prisma.parcelle.findFirst({ where: { label }, select: { id: true } });
    if (existing) {
      await prisma.parcelle.update({ where: { id: existing.id }, data });
    } else {
      await prisma.parcelle.create({ data });
    }
  }
}

function asCoordinateArray(value: unknown): Array<{ lat: number; lng: number }> | null {
  if (!Array.isArray(value)) return null;
  const coordinates = value.flatMap((point) => {
    if (!point || typeof point !== "object") return [];
    const values = point as Record<string, unknown>;
    return typeof values.lat === "number" && Number.isFinite(values.lat)
      && typeof values.lng === "number" && Number.isFinite(values.lng)
      ? [{ lat: values.lat, lng: values.lng }]
      : [];
  });
  return coordinates.length >= 3 ? coordinates : null;
}

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

async function fetchGrowingDegreeDays(lat: number, lng: number, config: BarleyDetectionConfig): Promise<GrowingDegreeDaySummary> {
  const endDate = new Date();
  endDate.setUTCDate(endDate.getUTCDate() - 2);
  const startDate = new Date(endDate);
  startDate.setUTCDate(startDate.getUTCDate() - config.periodDays + 1);
  const url = new URL("https://archive-api.open-meteo.com/v1/archive");
  url.search = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lng),
    start_date: formatDate(startDate),
    end_date: formatDate(endDate),
    daily: "temperature_2m_max,temperature_2m_min",
    timezone: "auto",
  }).toString();

  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error("Les données Open-Meteo sont indisponibles.");
  const payload: unknown = await response.json();
  const daily = payload && typeof payload === "object" && "daily" in payload ? payload.daily : null;
  if (!daily || typeof daily !== "object") throw new Error("Réponse météo incomplète.");
  const values = daily as { time?: unknown; temperature_2m_max?: unknown; temperature_2m_min?: unknown };
  if (!Array.isArray(values.time) || !Array.isArray(values.temperature_2m_max) || !Array.isArray(values.temperature_2m_min)) {
    throw new Error("Températures journalières indisponibles.");
  }
  const dates = values.time as unknown[];
  const tmaxValues = values.temperature_2m_max as unknown[];
  const tminValues = values.temperature_2m_min as unknown[];

  let cumulative = 0;
  let validDays = 0;
  const dailyValues: Array<{ date: string; tmax: number; tmin: number; dj: number }> = [];
  dates.forEach((date, index) => {
    const tmax = tmaxValues[index];
    const tmin = tminValues[index];
    if (typeof date !== "string" || typeof tmax !== "number" || typeof tmin !== "number") return;
    const dj = Math.round(((tmax + tmin) / 2 - config.baseTemperature) * 10) / 10;
    dailyValues.push({ date, tmax, tmin, dj });
    cumulative += dj;
    validDays += 1;
  });
  if (validDays === 0) throw new Error("Aucune température valide n’a été reçue.");

  return {
    dailyValues,
    cumulative: Math.round(cumulative * 10) / 10,
    detected: cumulative >= config.threshold,
    startDate: String(dates[0] ?? ""),
    endDate: String(dates.at(-1) ?? ""),
  };
}

async function mapWithConcurrency<T, R>(items: T[], concurrency: number, mapper: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  let cursor = 0;

  async function worker() {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await mapper(items[index]);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}
