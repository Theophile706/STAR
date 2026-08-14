const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type",
};

const HF_MODEL_URL = process.env.HF_MODEL_URL ?? "https://andritinatonny-agrisat.hf.space";
const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY;

// ── GEE Auth ──

export async function analyzeParcel(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { lat, lng, zoom, polygon } = await req.json();

    if (typeof lat !== "number" || typeof lng !== "number") {
      return new Response(
        JSON.stringify({ error: "lat et lng sont requis (nombres)" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const effectiveZoom = zoom || 16;
    const serviceAccountJson = process.env.GEE_SERVICE_ACCOUNT_KEY;
    if (!serviceAccountJson || serviceAccountJson.startsWith("VOTRE_")) {
      throw new Error("GEE_SERVICE_ACCOUNT_KEY n’est pas configurée.");
    }

    let sa: { project_id?: string };
    try {
      sa = JSON.parse(serviceAccountJson);
    } catch {
      throw new Error("GEE_SERVICE_ACCOUNT_KEY doit contenir un JSON Google valide.");
    }
    const projectId = sa.project_id || "earthengine-legacy";
    const accessToken = await getGeeAccessToken();

    const [satData, timeSeries, satelliteImageBase64] = await Promise.all([
      fetchCurrentSnapshot(accessToken, lat, lng, projectId),
      fetchTimeSeries(accessToken, lat, lng, projectId),
      captureParcelImage(lat, lng, effectiveZoom),
    ]);

    const planting = detectPlantingDate(timeSeries.s2, timeSeries.s1);
    const agro = computeAgroScore(satData, planting, timeSeries);

    const hfResult = await callHFModel(satelliteImageBase64);
    const hybrid = computeHybridScore(hfResult.confidence, hfResult.is_barley, agro.score);
    const season = detectSeason();
    const dataSource = [...satData.dataSource, `HF OrgeDetector (${HF_MODEL_URL})`].join(" + ");
    const spectralParts: string[] = [];
    if (satData.ndvi != null) spectralParts.push(`NDVI=${satData.ndvi}%`);
    if (satData.evi != null) spectralParts.push(`EVI=${satData.evi}%`);
    if (satData.savi != null) spectralParts.push(`SAVI=${satData.savi}%`);
    if (satData.ndwi != null) spectralParts.push(`NDWI=${satData.ndwi}`);
    const spectralAnalysis = spectralParts.length ? spectralParts.join(", ") : null;
    let radarAnalysis: string | null = null;
    if (satData.vv != null && satData.vh != null) {
      radarAnalysis = `VV=${satData.vv}dB, VH=${satData.vh}dB`;
      if (satData.vhVvRatio != null) radarAnalysis += `, VH/VV=${satData.vhVvRatio}`;
    }
    const riskFactors: string[] = [];
    if (satData.ndvi != null && satData.ndvi < 15) riskFactors.push("Végétation très faible");
    if (satData.ndvi != null && satData.ndvi > 85) riskFactors.push("Végétation trop dense pour de l'orge");
    if (satData.vhVvRatio != null && satData.vhVvRatio > 0.45) riskFactors.push("Structure radar type forêt");
    if (!hybrid.final_is_barley && hybrid.final_confidence > 70) riskFactors.push("Score hybride confirme non-orge");
    const detailParts: string[] = [];
    detailParts.push(`CNN: ${hfResult.is_barley ? "orge" : "non-orge"} (${hfResult.confidence.toFixed(1)}%)`);
    detailParts.push(`Agro: ${agro.score}%`);
    detailParts.push(`Hybride: ${hybrid.hybrid_score}%`);

    return new Response(JSON.stringify({
      percentage: satData.ndvi, is_barley: hfResult.is_barley,
      hf_model_url: HF_MODEL_URL, hf_available: true,
      verdict: hybrid.final_verdict, details: detailParts.join(" | "),
      culture_detected: hfResult.is_barley ? "Orge" : "Non-orge",
      confidence: hfResult.confidence, cnn_prob_barley: hfResult.prob_barley,
      cnn_prob_non_barley: hfResult.prob_non_barley, cnn_available: true,
      evi: satData.evi, savi: satData.savi, ndwi: satData.ndwi,
      agro_score: agro.score, agro_breakdown: agro.breakdown, agro_details: agro.details,
      hybrid_score: hybrid.hybrid_score, saison: season,
      soil_type: satData.swir != null && satData.nir != null && satData.nir !== 0
        ? (satData.swir / satData.nir > 1.5 ? "Sol argileux sec" : satData.swir / satData.nir > 1.0 ? "Sol limoneux" : "Sol humide")
        : null,
      risk_factors: riskFactors,
      recommendations: hybrid.final_is_barley
        ? `Orge ${hybrid.final_confidence > 70 ? "confirmée" : "probable"}. Score hybride ${hybrid.hybrid_score}% (CNN ${Math.round(hfResult.confidence)}% + Agro ${agro.score}%).`
        : `Non-orge détecté. Score hybride ${hybrid.hybrid_score}%. Vérification terrain recommandée.`,
      anomaly_level: hybrid.final_is_barley ? "AUCUNE" : "FORTE", data_source: dataSource,
      radar_analysis: radarAnalysis, spectral_analysis: spectralAnalysis,
      time_series_s2: timeSeries.s2, time_series_s1: timeSeries.s1,
      estimated_planting_date: planting.estimated_planting_date,
      estimated_harvest_date: planting.estimated_harvest_date,
      days_since_planting: planting.days_since_planting, growth_stage: planting.growth_stage,
      planting_confidence: planting.planting_confidence,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("analyze-parcel error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
}

async function getGeeAccessToken(): Promise<string> {
  const serviceAccountJson = process.env.GEE_SERVICE_ACCOUNT_KEY;
  if (!serviceAccountJson) throw new Error("GEE_SERVICE_ACCOUNT_KEY is not configured");

  const sa = JSON.parse(serviceAccountJson);
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const claimSet = {
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/earthengine.readonly",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  };

  const enc = (obj: unknown) =>
    btoa(JSON.stringify(obj)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const unsignedToken = `${enc(header)}.${enc(claimSet)}`;

  const pemBody = sa.private_key
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\n/g, "");
  const binaryDer = Uint8Array.from(atob(pemBody), (c) => c.charCodeAt(0));

  const cryptoKey = await crypto.subtle.importKey(
    "pkcs8", binaryDer,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]
  );

  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5", cryptoKey, new TextEncoder().encode(unsignedToken)
  );

  const sig = btoa(String.fromCharCode(...new Uint8Array(signature)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

  const jwt = `${unsignedToken}.${sig}`;

  const tokenResp = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`,
  });

  if (!tokenResp.ok) {
    const err = await tokenResp.text();
    console.error("GEE token error:", err);
    throw new Error(`Failed to get GEE access token: ${tokenResp.status}`);
  }

  return (await tokenResp.json()).access_token;
}

// ── GEE Expression Builders ──

function buildS2Expression(lat: number, lng: number, startDate: string, endDate: string) {
  return {
    expression: {
      result: "0",
      values: {
        "1": {
          functionInvocationValue: {
            functionName: "GeometryConstructors.Point",
            arguments: { coordinates: { constantValue: [lng, lat] } },
          },
        },
        "0": {
          functionInvocationValue: {
            functionName: "Image.reduceRegion",
            arguments: {
              geometry: { valueReference: "1" },
              image: {
                functionInvocationValue: {
                  functionName: "reduce.median",
                  arguments: {
                    collection: {
                      functionInvocationValue: {
                        functionName: "Collection.filter",
                        arguments: {
                          collection: {
                            functionInvocationValue: {
                              functionName: "Collection.filter",
                              arguments: {
                                collection: {
                                  functionInvocationValue: {
                                    functionName: "Collection.filter",
                                    arguments: {
                                      collection: {
                                        functionInvocationValue: {
                                          functionName: "ImageCollection.load",
                                          arguments: { id: { constantValue: "COPERNICUS/S2_SR_HARMONIZED" } },
                                        },
                                      },
                                      filter: {
                                        functionInvocationValue: {
                                          functionName: "Filter.intersects",
                                          arguments: {
                                            leftField: { constantValue: ".all" },
                                            rightValue: {
                                              functionInvocationValue: {
                                                functionName: "Feature",
                                                arguments: { geometry: { valueReference: "1" } },
                                              },
                                            },
                                          },
                                        },
                                      },
                                    },
                                  },
                                },
                                filter: {
                                  functionInvocationValue: {
                                    functionName: "Filter.dateRangeContains",
                                    arguments: {
                                      leftValue: {
                                        functionInvocationValue: {
                                          functionName: "DateRange",
                                          arguments: {
                                            start: { constantValue: startDate },
                                            end: { constantValue: endDate },
                                          },
                                        },
                                      },
                                      rightField: { constantValue: "system:time_start" },
                                    },
                                  },
                                },
                              },
                            },
                          },
                          filter: {
                            functionInvocationValue: {
                              functionName: "Filter.lessThan",
                              arguments: {
                                leftField: { constantValue: "CLOUDY_PIXEL_PERCENTAGE" },
                                rightValue: { constantValue: 30 },
                              },
                            },
                          },
                        },
                      },
                    },
                  },
                },
              },
              reducer: {
                functionInvocationValue: { functionName: "Reducer.mean", arguments: {} },
              },
              scale: { constantValue: 10 },
            },
          },
        },
      },
    },
  };
}

function buildS1Expression(lat: number, lng: number, startDate: string, endDate: string) {
  return {
    expression: {
      result: "0",
      values: {
        "1": {
          functionInvocationValue: {
            functionName: "GeometryConstructors.Point",
            arguments: { coordinates: { constantValue: [lng, lat] } },
          },
        },
        "0": {
          functionInvocationValue: {
            functionName: "Image.reduceRegion",
            arguments: {
              geometry: { valueReference: "1" },
              image: {
                functionInvocationValue: {
                  functionName: "reduce.median",
                  arguments: {
                    collection: {
                      functionInvocationValue: {
                        functionName: "Collection.filter",
                        arguments: {
                          collection: {
                            functionInvocationValue: {
                              functionName: "Collection.filter",
                              arguments: {
                                collection: {
                                  functionInvocationValue: {
                                    functionName: "Collection.filter",
                                    arguments: {
                                      collection: {
                                        functionInvocationValue: {
                                          functionName: "ImageCollection.load",
                                          arguments: { id: { constantValue: "COPERNICUS/S1_GRD" } },
                                        },
                                      },
                                      filter: {
                                        functionInvocationValue: {
                                          functionName: "Filter.intersects",
                                          arguments: {
                                            leftField: { constantValue: ".all" },
                                            rightValue: {
                                              functionInvocationValue: {
                                                functionName: "Feature",
                                                arguments: { geometry: { valueReference: "1" } },
                                              },
                                            },
                                          },
                                        },
                                      },
                                    },
                                  },
                                },
                                filter: {
                                  functionInvocationValue: {
                                    functionName: "Filter.dateRangeContains",
                                    arguments: {
                                      leftValue: {
                                        functionInvocationValue: {
                                          functionName: "DateRange",
                                          arguments: {
                                            start: { constantValue: startDate },
                                            end: { constantValue: endDate },
                                          },
                                        },
                                      },
                                      rightField: { constantValue: "system:time_start" },
                                    },
                                  },
                                },
                              },
                            },
                          },
                          filter: {
                            functionInvocationValue: {
                              functionName: "Filter.equals",
                              arguments: {
                                leftField: { constantValue: "instrumentMode" },
                                rightValue: { constantValue: "IW" },
                              },
                            },
                          },
                        },
                      },
                    },
                  },
                },
              },
              reducer: {
                functionInvocationValue: { functionName: "Reducer.mean", arguments: {} },
              },
              scale: { constantValue: 10 },
            },
          },
        },
      },
    },
  };
}

// ── GEE compute helper ──

async function callGeeCompute(accessToken: string, projectId: string, expression: unknown): Promise<Record<string, number | null> | null> {
  const url = `https://earthengine.googleapis.com/v1/projects/${projectId}/value:compute`;
  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify(expression),
    });
    if (!resp.ok) {
      const errText = await resp.text().catch(() => "");
      console.error("GEE API error:", resp.status, errText.slice(0, 300));
      return null;
    }
    const data = await resp.json();
    return data.result || null;
  } catch (e) {
    console.error("GEE fetch error:", e);
    return null;
  }
}

// ── Satellite data types ──

interface SpectralIndices {
  ndvi: number | null;
  ndwi: number | null;
  evi: number | null;
  savi: number | null;
}

interface SatelliteData {
  ndvi: number | null;
  ndwi: number | null;
  evi: number | null;
  savi: number | null;
  blue: number | null;
  nir: number | null;
  red: number | null;
  green: number | null;
  swir: number | null;
  vv: number | null;
  vh: number | null;
  vhVvRatio: number | null;
  dataSource: string[];
}

function parseS2Bands(result: Record<string, number | null>) {
  const nir = result.B8_mean ?? result.B8_median ?? result.B8 ?? null;
  const red = result.B4_mean ?? result.B4_median ?? result.B4 ?? null;
  const green = result.B3_mean ?? result.B3_median ?? result.B3 ?? null;
  const blue = result.B2_mean ?? result.B2_median ?? result.B2 ?? null;
  const swir = result.B11_mean ?? result.B11_median ?? result.B11 ?? null;
  return { nir, red, green, blue, swir };
}

function parseS1Bands(result: Record<string, number | null>) {
  const vv = result.VV_mean ?? result.VV_median ?? result.VV ?? null;
  const vh = result.VH_mean ?? result.VH_median ?? result.VH ?? null;
  return { vv, vh };
}

/** Compute all spectral indices from raw bands */
function computeSpectralIndices(nir: number | null, red: number | null, blue: number | null, green: number | null, swir: number | null): SpectralIndices {
  let ndvi: number | null = null;
  let ndwi: number | null = null;
  let evi: number | null = null;
  let savi: number | null = null;

  // NDVI = (NIR - RED) / (NIR + RED)
  if (nir != null && red != null && (nir + red) !== 0) {
    ndvi = Math.round(((nir - red) / (nir + red)) * 1000) / 10; // as percentage
  }

  // NDWI = (GREEN - NIR) / (GREEN + NIR)
  if (green != null && nir != null && (green + nir) !== 0) {
    ndwi = Math.round(((green - nir) / (green + nir)) * 1000) / 1000;
  }

  // EVI = 2.5 * (NIR - RED) / (NIR + 6*RED - 7.5*BLUE + 1)
  if (nir != null && red != null && blue != null) {
    const denom = nir + 6 * red - 7.5 * blue + 10000; // +10000 for S2 SR scale
    if (denom !== 0) {
      const rawEvi = 2.5 * (nir - red) / denom;
      evi = Math.round(rawEvi * 1000) / 10; // as percentage
    }
  }

  // SAVI = ((NIR - RED) / (NIR + RED + L)) * (1 + L), L=0.5
  if (nir != null && red != null && (nir + red + 0.5) !== 0) {
    const L = 0.5;
    const rawSavi = ((nir - red) / (nir + red + L)) * (1 + L);
    savi = Math.round(rawSavi * 1000) / 10; // as percentage-like
  }

  return { ndvi, ndwi, evi, savi };
}

async function fetchCurrentSnapshot(accessToken: string, lat: number, lng: number, projectId: string): Promise<SatelliteData> {
  const now = new Date();
  const end = now.toISOString().slice(0, 10);
  const start = new Date(now.getTime() - 180 * 86400000).toISOString().slice(0, 10);

  const [s2Result, s1Result] = await Promise.all([
    callGeeCompute(accessToken, projectId, buildS2Expression(lat, lng, start, end)),
    callGeeCompute(accessToken, projectId, buildS1Expression(lat, lng, start, end)),
  ]);

  const result: SatelliteData = {
    ndvi: null, ndwi: null, evi: null, savi: null,
    blue: null, nir: null, red: null, green: null, swir: null,
    vv: null, vh: null, vhVvRatio: null, dataSource: [],
  };

  if (s2Result) {
    const { nir, red, green, blue, swir } = parseS2Bands(s2Result);
    result.nir = nir;
    result.red = red;
    result.green = green;
    result.blue = blue;
    result.swir = swir;

    const indices = computeSpectralIndices(nir, red, blue, green, swir);
    result.ndvi = indices.ndvi != null ? Math.round(indices.ndvi) : null;
    result.ndwi = indices.ndwi;
    result.evi = indices.evi != null ? Math.round(indices.evi * 10) / 10 : null;
    result.savi = indices.savi != null ? Math.round(indices.savi * 10) / 10 : null;

    result.dataSource.push("Sentinel-2");
  }

  if (s1Result) {
    const { vv, vh } = parseS1Bands(s1Result);
    if (vv != null) result.vv = Math.round(vv * 100) / 100;
    if (vh != null) result.vh = Math.round(vh * 100) / 100;
    if (vv != null && vh != null && vv !== 0) {
      result.vhVvRatio = Math.round((vh / vv) * 1000) / 1000;
    }
    result.dataSource.push("Sentinel-1");
  }

  return result;
}

// ── Time Series ──

interface TimeSeriesPointS2 { date: string; ndvi: number | null; cloud_cover: number | null; }
interface TimeSeriesPointS1 { date: string; vv: number | null; vh: number | null; }

function getMonthlyRanges(numMonths: number): Array<{ label: string; start: string; end: string }> {
  const now = new Date();
  const ranges: Array<{ label: string; start: string; end: string }> = [];
  for (let i = numMonths - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const start = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
    const endD = new Date(d.getFullYear(), d.getMonth() + 2, 0);
    const end = `${endD.getFullYear()}-${String(endD.getMonth() + 1).padStart(2, "0")}-${String(endD.getDate()).padStart(2, "0")}`;
    ranges.push({ label: start.slice(0, 7), start, end });
  }
  return ranges;
}

async function fetchTimeSeries(
  accessToken: string, lat: number, lng: number, projectId: string
): Promise<{ s2: TimeSeriesPointS2[]; s1: TimeSeriesPointS1[] }> {
  const months = getMonthlyRanges(6);

  const s2Promises = months.map(async (m) => {
    const result = await callGeeCompute(accessToken, projectId, buildS2Expression(lat, lng, m.start, m.end));
    let ndvi: number | null = null;
    if (result) {
      const { nir, red } = parseS2Bands(result);
      if (nir != null && red != null && (nir + red) !== 0) {
        ndvi = Math.round(((nir - red) / (nir + red)) * 1000) / 10;
      }
    }
    return { date: m.label, ndvi, cloud_cover: null } as TimeSeriesPointS2;
  });

  const s1Promises = months.map(async (m) => {
    const result = await callGeeCompute(accessToken, projectId, buildS1Expression(lat, lng, m.start, m.end));
    let vv: number | null = null;
    let vh: number | null = null;
    if (result) {
      const parsed = parseS1Bands(result);
      if (parsed.vv != null) vv = Math.round(parsed.vv * 100) / 100;
      if (parsed.vh != null) vh = Math.round(parsed.vh * 100) / 100;
    }
    return { date: m.label, vv, vh } as TimeSeriesPointS1;
  });

  const [s2, s1] = await Promise.all([Promise.all(s2Promises), Promise.all(s1Promises)]);
  return { s2, s1 };
}

// ── Planting Date Detection ──

interface PlantingDetection {
  estimated_planting_date: string | null;
  estimated_harvest_date: string | null;
  days_since_planting: number | null;
  growth_stage: string | null;
  planting_confidence: number;
}

function detectPlantingDate(s2: TimeSeriesPointS2[], s1: TimeSeriesPointS1[]): PlantingDetection {
  const validS2 = s2.filter((p) => p.ndvi != null);
  if (validS2.length < 2) {
    return { estimated_planting_date: null, estimated_harvest_date: null, days_since_planting: null, growth_stage: null, planting_confidence: 0 };
  }

  let maxJump = 0;
  let jumpIndex = -1;
  for (let i = 1; i < validS2.length; i++) {
    const delta = validS2[i].ndvi! - validS2[i - 1].ndvi!;
    if (delta > maxJump) { maxJump = delta; jumpIndex = i; }
  }

  if (maxJump < 15 || jumpIndex < 0) {
    const minIdx = validS2.reduce((mi, p, i) => (p.ndvi! < validS2[mi].ndvi! ? i : mi), 0);
    if (minIdx < validS2.length - 1 && validS2[minIdx + 1].ndvi! - validS2[minIdx].ndvi! > 5) {
      jumpIndex = minIdx + 1;
      maxJump = validS2[jumpIndex].ndvi! - validS2[minIdx].ndvi!;
    } else {
      return { estimated_planting_date: null, estimated_harvest_date: null, days_since_planting: null, growth_stage: null, planting_confidence: 0 };
    }
  }

  const jumpMonth = validS2[jumpIndex].date;
  const [year, month] = jumpMonth.split("-").map(Number);
  const plantingDate = new Date(year, month - 1, 10);

  let confidence = Math.min(90, Math.round(maxJump * 2));
  if (s1.length > 0 && jumpIndex < s1.length) {
    const s1Jump = s1[jumpIndex];
    const s1Prev = jumpIndex > 0 ? s1[jumpIndex - 1] : null;
    if (s1Jump.vv != null && s1Prev?.vv != null && s1Jump.vv - s1Prev.vv > 0.5) {
      confidence = Math.min(95, confidence + 10);
    }
  }

  const now = new Date();
  const daysSincePlanting = Math.round((now.getTime() - plantingDate.getTime()) / 86400000);

  let growthStage: string;
  if (daysSincePlanting < 0) growthStage = "Pré-semis";
  else if (daysSincePlanting <= 7) growthStage = "Semis";
  else if (daysSincePlanting <= 20) growthStage = "Levée";
  else if (daysSincePlanting <= 45) growthStage = "Tallage";
  else if (daysSincePlanting <= 65) growthStage = "Montaison";
  else if (daysSincePlanting <= 80) growthStage = "Épiaison";
  else if (daysSincePlanting <= 110) growthStage = "Maturation";
  else growthStage = "Récolte";

  const harvestDate = new Date(plantingDate.getTime() + 100 * 86400000);

  return {
    estimated_planting_date: plantingDate.toISOString().slice(0, 10),
    estimated_harvest_date: harvestDate.toISOString().slice(0, 10),
    days_since_planting: Math.max(0, daysSincePlanting),
    growth_stage: growthStage,
    planting_confidence: confidence,
  };
}

// ── Agronomic Rules Scoring ──

interface AgroScore {
  score: number; // 0-100
  breakdown: {
    ndvi_score: number;
    cycle_score: number;
    radar_score: number;
    ndvi_trend_score: number;
  };
  details: string;
}

function computeAgroScore(
  satData: SatelliteData,
  planting: PlantingDetection,
  timeSeries: { s2: TimeSeriesPointS2[]; s1: TimeSeriesPointS1[] }
): AgroScore {
  let ndviScore = 0;
  let cycleScore = 0;
  let radarScore = 0;
  let ndviTrendScore = 0;
  const details: string[] = [];

  // 1. NDVI range check for barley (typical: 30-80% at peak, 20-60% average)
  if (satData.ndvi != null) {
    const ndvi = satData.ndvi;
    if (ndvi >= 25 && ndvi <= 75) {
      ndviScore = 80 + (1 - Math.abs(ndvi - 50) / 25) * 20; // peak around 50%
      details.push(`NDVI ${ndvi}% dans la plage orge`);
    } else if (ndvi >= 15 && ndvi <= 85) {
      ndviScore = 40;
      details.push(`NDVI ${ndvi}% limite pour l'orge`);
    } else {
      ndviScore = 10;
      details.push(`NDVI ${ndvi}% hors plage orge typique`);
    }
  }

  // 2. Growth cycle coherence (barley = 90-120 days)
  if (planting.days_since_planting != null && planting.growth_stage) {
    const days = planting.days_since_planting;
    if (days >= 0 && days <= 130) {
      cycleScore = 80;
      // Check NDVI vs expected stage
      if (satData.ndvi != null) {
        const ndvi = satData.ndvi;
        if (planting.growth_stage === "Levée" && ndvi >= 15 && ndvi <= 40) cycleScore = 95;
        else if (planting.growth_stage === "Tallage" && ndvi >= 30 && ndvi <= 65) cycleScore = 95;
        else if (planting.growth_stage === "Montaison" && ndvi >= 40 && ndvi <= 80) cycleScore = 95;
        else if (planting.growth_stage === "Épiaison" && ndvi >= 50 && ndvi <= 80) cycleScore = 95;
        else if (planting.growth_stage === "Maturation" && ndvi >= 30 && ndvi <= 60) cycleScore = 90;
        else if (planting.growth_stage === "Récolte" && ndvi >= 10 && ndvi <= 40) cycleScore = 90;
      }
      details.push(`Cycle ${days}j cohérent (stade ${planting.growth_stage})`);
    } else if (days > 130) {
      cycleScore = 30;
      details.push(`Cycle ${days}j > 130j, dépasse le cycle orge`);
    }
  } else {
    cycleScore = 50; // neutral if no planting detected
  }

  // 3. Radar signature check (barley typically: VV -8 to -14 dB, VH -14 to -22 dB)
  if (satData.vv != null && satData.vh != null) {
    const vv = satData.vv;
    const vh = satData.vh;
    if (vv >= -14 && vv <= -8 && vh >= -22 && vh <= -14) {
      radarScore = 90;
      details.push(`Radar VV=${vv}dB VH=${vh}dB typique cultures`);
    } else if (vv >= -16 && vv <= -6 && vh >= -24 && vh <= -12) {
      radarScore = 60;
      details.push(`Radar acceptable mais pas typique orge`);
    } else {
      radarScore = 20;
      details.push(`Signature radar atypique pour céréales`);
    }

    // VH/VV ratio: barley typically 0.3-0.6
    if (satData.vhVvRatio != null) {
      const ratio = satData.vhVvRatio;
      if (ratio >= 0.3 && ratio <= 0.6) radarScore = Math.min(100, radarScore + 10);
    }
  } else {
    radarScore = 50; // neutral if no radar
  }

  // 4. NDVI temporal trend (barley: rise then fall pattern)
  const validNdvi = timeSeries.s2.filter(p => p.ndvi != null).map(p => p.ndvi!);
  if (validNdvi.length >= 3) {
    // Check for rise-fall pattern
    const maxNdvi = Math.max(...validNdvi);
    const minNdvi = Math.min(...validNdvi);
    const range = maxNdvi - minNdvi;

    if (range >= 15) {
      // Good dynamic range - typical of crops
      ndviTrendScore = 70 + Math.min(30, range);
      details.push(`Dynamique NDVI ${range.toFixed(0)}% (bon signal cultural)`);
    } else if (range >= 5) {
      ndviTrendScore = 50;
      details.push(`Dynamique NDVI faible (${range.toFixed(0)}%)`);
    } else {
      ndviTrendScore = 20;
      details.push(`NDVI stable - pas typique d'une culture`);
    }
  } else {
    ndviTrendScore = 50;
  }

  // Weighted average
  const score = Math.round(
    ndviScore * 0.3 + cycleScore * 0.25 + radarScore * 0.25 + ndviTrendScore * 0.2
  );

  return {
    score: Math.max(0, Math.min(100, score)),
    breakdown: {
      ndvi_score: Math.round(ndviScore),
      cycle_score: Math.round(cycleScore),
      radar_score: Math.round(radarScore),
      ndvi_trend_score: Math.round(ndviTrendScore),
    },
    details: details.join(" | "),
  };
}

// ── Hybrid Score Fusion ──

function computeHybridScore(cnnConfidence: number, cnnIsBarley: boolean, agroScore: number): {
  hybrid_score: number;
  final_is_barley: boolean;
  final_verdict: string;
  final_confidence: number;
} {
  // CNN score: positive if barley, inverted if not
  const cnnScore = cnnIsBarley ? cnnConfidence : (100 - cnnConfidence);

  // Hybrid = 0.6 * CNN + 0.4 * Agro
  const hybridScore = Math.round(cnnScore * 0.6 + agroScore * 0.4);

  // Disagreement penalty
  const disagreement = Math.abs(cnnScore - agroScore);
  const penalty = disagreement > 40 ? disagreement * 0.15 : 0;
  const finalConfidence = Math.max(0, Math.min(100, Math.round(hybridScore - penalty)));

  const finalIsBarley = hybridScore > 50;

  let verdict: string;
  if (finalIsBarley) {
    if (finalConfidence > 80) verdict = "✅ ORGE CONFIRMÉE — CNN + Règles agro concordent";
    else if (finalConfidence > 60) verdict = "🟡 ORGE PROBABLE — Confiance modérée";
    else verdict = "⚠️ ORGE INCERTAIN — Validation terrain recommandée";
  } else {
    if (finalConfidence > 80) verdict = "❌ NON-ORGE CONFIRMÉ — CNN + Agro concordent";
    else if (finalConfidence > 60) verdict = "🟡 PROBABLEMENT NON-ORGE";
    else verdict = "⚠️ INDÉTERMINÉ — Données insuffisantes";
  }

  if (disagreement > 40) {
    verdict += ` (⚠️ désaccord CNN/Agro: ${disagreement.toFixed(0)}%)`;
  }

  return {
    hybrid_score: hybridScore,
    final_is_barley: finalIsBarley,
    final_verdict: verdict,
    final_confidence: finalConfidence,
  };
}

// ── HuggingFace Model Integration ──

async function captureParcelImage(lat: number, lng: number, zoom: number): Promise<string> {
  if (!GOOGLE_MAPS_API_KEY || GOOGLE_MAPS_API_KEY.startsWith("VOTRE_")) {
    throw new Error("GOOGLE_MAPS_API_KEY n’est pas configurée.");
  }
  const staticUrl = `https://maps.googleapis.com/maps/api/staticmap?center=${lat},${lng}&zoom=${zoom}&size=640x640&maptype=satellite&key=${GOOGLE_MAPS_API_KEY}`;

  const resp = await fetch(staticUrl);
  if (!resp.ok) {
    throw new Error(`Google Maps Static API error: ${resp.status}`);
  }

  const arrayBuffer = await resp.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

interface HFModelResult {
  is_barley: boolean;
  confidence: number;
  prob_barley: number;
  prob_non_barley: number;
}

async function callHFModel(satelliteImageBase64: string): Promise<HFModelResult> {
  console.log("Calling HF model /predict at:", HF_MODEL_URL);

  const binaryStr = atob(satelliteImageBase64);
  const bytes = new Uint8Array(binaryStr.length);
  for (let i = 0; i < binaryStr.length; i++) {
    bytes[i] = binaryStr.charCodeAt(i);
  }

  const formData = new FormData();
  const blob = new Blob([bytes], { type: "image/png" });
  formData.append("file", blob, "parcel.png");

  const resp = await fetch(`${HF_MODEL_URL}/predict`, {
    method: "POST",
    body: formData,
  });

  if (!resp.ok) {
    const errText = await resp.text().catch(() => "");
    console.error("HF /predict error:", resp.status, errText.slice(0, 500));
    throw new Error(`HF model error: ${resp.status}`);
  }

  const data: unknown = await resp.json();
  console.log("HF /predict response:", JSON.stringify(data));
  if (!data || typeof data !== "object") throw new Error("Réponse du modèle HF invalide.");

  const values = data as Record<string, unknown>;
  if (
    typeof values.is_barley !== "boolean"
    || typeof values.confidence !== "number"
    || !Number.isFinite(values.confidence)
    || typeof values.prob_barley !== "number"
    || !Number.isFinite(values.prob_barley)
    || typeof values.prob_non_barley !== "number"
    || !Number.isFinite(values.prob_non_barley)
  ) {
    throw new Error("La réponse du modèle HF ne contient pas les valeurs attendues.");
  }

  return {
    is_barley: values.is_barley,
    confidence: values.confidence,
    prob_barley: values.prob_barley,
    prob_non_barley: values.prob_non_barley,
  };
}

// ── Season detection ──

function detectSeason(): string {
  const month = new Date().getMonth() + 1;
  if (month >= 10 || month <= 11) return "Semis / Levée";
  if (month >= 12 || month <= 2) return "Tallage";
  if (month >= 3 && month <= 4) return "Montaison";
  if (month === 5) return "Épiaison";
  if (month === 6) return "Maturation";
  if (month >= 7 && month <= 8) return "Récolte / Post-récolte";
  return "Jachère";
}
