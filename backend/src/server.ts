import "dotenv/config";
import "dotenv/config";
import Fastify from "fastify";
import cors from "@fastify/cors";
import { Prisma, PrismaClient } from "@prisma/client";
import { z } from "zod";
import { analyzeParcel } from "./analyze-parcel.js";
import { detectAutomaticParcels } from "./automatic-parcels.js";

const app = Fastify({ logger: true });
const prisma = new PrismaClient();

const jsonValue = (value: unknown) => value as Prisma.InputJsonValue;

const pointSchema = z.object({ lat: z.number(), lng: z.number() });
const automaticDetectionSchema = z.object({
  lat: z.number().finite().min(-90).max(90),
  lng: z.number().finite().min(-180).max(180),
  radiusKm: z.number().finite().min(1).max(20),
  baseTemperature: z.number().finite().min(-20).max(30),
  threshold: z.number().finite().min(2200).max(10000),
  periodDays: z.number().int().min(1).max(730),
});
const parcelleSchema = z.object({
  label: z.string().max(200),
  coordinates: z.array(pointSchema).min(3),
  center_lat: z.number(),
  center_lng: z.number(),
  surface_ha: z.number().nullable(),
  culture_declared: z.string(),
  culture_detected: z.string().nullable(),
  ndvi_percentage: z.number().nullable(),
  confidence: z.number().nullable(),
  verdict: z.string().nullable(),
  details: z.string().nullable(),
  saison: z.string().nullable(),
  soil_type: z.string().nullable(),
  risk_factors: z.array(z.string()),
  recommendations: z.string().nullable(),
  data_source: z.string().nullable(),
  owner_name: z.string(),
  notes: z.string(),
  time_series_s2: z.array(z.unknown()),
  time_series_s1: z.array(z.unknown()),
  estimated_planting_date: z.string().nullable(),
  estimated_harvest_date: z.string().nullable(),
  days_since_planting: z.number().nullable(),
  growth_stage: z.string().nullable(),
  planting_confidence: z.number().nullable(),
  evi: z.number().nullable(),
  savi: z.number().nullable(),
  ndwi: z.number().nullable(),
  agro_score: z.number().nullable(),
  hybrid_score: z.number().nullable(),
  cnn_prob_barley: z.number().nullable(),
  cnn_prob_non_barley: z.number().nullable(),
});

app.register(cors, { origin: process.env.FRONTEND_ORIGIN?.split(",") ?? true });

app.setErrorHandler((error, _request, reply) => {
  app.log.error(error);
  const statusCode = typeof error === "object" && error !== null && "statusCode" in error && typeof error.statusCode === "number" && error.statusCode < 500
    ? error.statusCode
    : 500;
  const message = error instanceof Error ? error.message : "Erreur interne du serveur";
  return reply.code(statusCode).send({ error: statusCode === 500 ? "Erreur interne du serveur" : message });
});

app.get("/health", async () => ({ status: "ok" }));

// Fallback endpoint that always returns a detection result (uses internal fallback on errors)
app.post("/api/detect-parcels-fallback", async (request, reply) => {
  const parsed = automaticDetectionSchema.safeParse(request.body);
  if (!parsed.success) return reply.code(400).send({ error: "Coordonnées ou rayon invalides.", details: parsed.error.flatten() });
  const result = await detectAutomaticParcels(parsed.data);
  return reply.send(result);
});

app.get("/api/parcelles", async (_request, reply) => {
  const parcelles = await prisma.parcelle.findMany({ orderBy: { created_at: "desc" } });
  return reply.send(parcelles);
});

app.post("/api/parcelles", async (request, reply) => {
  const parsed = parcelleSchema.safeParse(request.body);
  if (!parsed.success) return reply.code(400).send({ error: "Données de parcelle invalides", details: parsed.error.flatten() });

  const { coordinates, risk_factors, time_series_s1, time_series_s2, ...scalarData } = parsed.data;
  const parcelle = await prisma.parcelle.create({
    data: {
      ...scalarData,
      coordinates: jsonValue(coordinates),
      risk_factors: jsonValue(risk_factors),
      time_series_s1: jsonValue(time_series_s1),
      time_series_s2: jsonValue(time_series_s2),
    },
  });
  return reply.code(201).send(parcelle);
});

app.delete("/api/parcelles/:id", async (request, reply) => {
  const id = z.string().uuid().safeParse((request.params as { id: string }).id);
  if (!id.success) return reply.code(400).send({ error: "Identifiant invalide" });
  const result = await prisma.parcelle.deleteMany({ where: { id: id.data } });
  if (result.count === 0) return reply.code(404).send({ error: "Parcelle introuvable" });
  return reply.code(204).send();
});

app.post("/api/analyze-parcel", async (request, reply) => {
  const response = await analyzeParcel(new Request("http://backend/analyze-parcel", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(request.body),
  }));
  return reply.code(response.status).headers(Object.fromEntries(response.headers.entries())).send(await response.text());
});

app.post("/api/detect-parcels", async (request, reply) => {
  const parsed = automaticDetectionSchema.safeParse(request.body);
  if (!parsed.success) return reply.code(400).send({ error: "Coordonnées ou rayon invalides.", details: parsed.error.flatten() });
  try {
    const result = await detectAutomaticParcels(parsed.data);
    return reply.send(result);
  } catch (error) {
    app.log.warn({ err: error }, "detect-parcels: discovery failed, returning fallback notice");
    const msg = error instanceof Error ? error.message : "Le service de recherche des parcelles est indisponible.";
    // Return a graceful fallback so the frontend can display a notice instead of 502
    const fallback = {
      center: { lat: parsed.data.lat, lng: parsed.data.lng },
      radius_km: parsed.data.radiusKm,
      base_temperature: parsed.data.baseTemperature,
      threshold: parsed.data.threshold,
      period_days: parsed.data.periodDays,
      candidates_found: 0,
      analyzed_count: 0,
      parcels: [],
      notice: msg.includes("database") || msg.includes("Database") || msg.toLowerCase().includes("parcelles") ? "La base des parcelles agricoles est indisponible. Essayez un rayon plus large ou vérifiez la configuration de la base de données." : msg,
    };
    return reply.send(fallback);
  }
});

const port = Number(process.env.PORT ?? 3001);
const host = process.env.HOST ?? "0.0.0.0";

app.listen({ port, host }).catch(async (error) => {
  app.log.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
