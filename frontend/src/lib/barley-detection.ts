export interface DailyTemperature {
  date: string;
  tmax: number;
  tmin: number;
}

export interface GrowingDegreeDay {
  date: string;
  tmax: number;
  tmin: number;
  value: number;
}

export interface BarleyDetectionConfig {
  baseTemperature: number;
  threshold: number;
  periodDays: number;
}

export interface BarleyDetectionResult {
  dailyValues: GrowingDegreeDay[];
  cumulativeGdd: number;
  isBarleyDetected: boolean;
  dataStartDate: string;
  dataEndDate: string;
}

export const DEFAULT_BARLEY_DETECTION_CONFIG: BarleyDetectionConfig = {
  baseTemperature: 0,
  threshold: 2200,
  periodDays: 365,
};

const round = (value: number) => Math.round(value * 10) / 10;

export function calculateDailyGrowingDegreeDay(tmax: number, tmin: number, baseTemperature: number): number {
  const dj = (tmax + tmin) / 2 - baseTemperature;
  return round(Math.max(0, dj));
}

export function summarizeBarleyDetection(
  temperatures: DailyTemperature[],
  config: Pick<BarleyDetectionConfig, "baseTemperature" | "threshold">
): BarleyDetectionResult {
  const dailyValues = temperatures.map(({ date, tmax, tmin }) => ({
    date,
    tmax,
    tmin,
    value: calculateDailyGrowingDegreeDay(tmax, tmin, config.baseTemperature),
  }));
  const cumulativeGdd = round(dailyValues.reduce((sum, day) => sum + day.value, 0));

  return {
    dailyValues,
    cumulativeGdd,
    isBarleyDetected: cumulativeGdd >= config.threshold,
    dataStartDate: dailyValues[0]?.date ?? "",
    dataEndDate: dailyValues.at(-1)?.date ?? "",
  };
}

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export async function fetchBarleyDetection(
  latitude: number,
  longitude: number,
  config: BarleyDetectionConfig
): Promise<BarleyDetectionResult> {
  const endDate = new Date();
  endDate.setUTCDate(endDate.getUTCDate() - 2);
  const startDate = new Date(endDate);
  startDate.setUTCDate(startDate.getUTCDate() - config.periodDays + 1);

  const url = new URL("https://archive-api.open-meteo.com/v1/archive");
  url.search = new URLSearchParams({
    latitude: String(latitude),
    longitude: String(longitude),
    start_date: formatDate(startDate),
    end_date: formatDate(endDate),
    daily: "temperature_2m_max,temperature_2m_min",
    timezone: "auto",
  }).toString();

  const response = await fetch(url);
  if (!response.ok) throw new Error("Les données Open-Meteo sont indisponibles.");

  const data: unknown = await response.json();
  const daily = data && typeof data === "object" && "daily" in data ? data.daily : null;
  if (!daily || typeof daily !== "object") throw new Error("Réponse météo incomplète.");

  const values = daily as {
    time?: unknown;
    temperature_2m_max?: unknown;
    temperature_2m_min?: unknown;
  };
  if (!Array.isArray(values.time) || !Array.isArray(values.temperature_2m_max) || !Array.isArray(values.temperature_2m_min)) {
    throw new Error("Températures journalières indisponibles.");
  }

  const temperatures = values.time.flatMap((date, index): DailyTemperature[] => {
    const tmax = values.temperature_2m_max?.[index];
    const tmin = values.temperature_2m_min?.[index];
    if (typeof date !== "string" || typeof tmax !== "number" || typeof tmin !== "number") return [];
    return [{ date, tmax, tmin }];
  });

  if (temperatures.length === 0) throw new Error("Aucune température valide n’a été reçue.");

  return summarizeBarleyDetection(temperatures, config);
}
