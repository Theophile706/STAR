import { describe, expect, it } from "vitest";
import { DEFAULT_BARLEY_DETECTION_CONFIG, calculateDailyGrowingDegreeDay, summarizeBarleyDetection } from "@/lib/barley-detection";

describe("barley growing degree days", () => {
  it("applique la formule configurée à une température journalière", () => {
    expect(calculateDailyGrowingDegreeDay(24, 10, 5)).toBe(12);
  });

  it("détecte l’orge lorsque le cumul atteint le seuil", () => {
    const result = summarizeBarleyDetection(
      [
        { date: "2025-01-01", tmax: 20, tmin: 10 },
        { date: "2025-01-02", tmax: 22, tmin: 10 },
      ],
      { baseTemperature: 0, threshold: 31 }
    );

    expect(result.cumulativeGdd).toBe(31);
    expect(result.isBarleyDetected).toBe(true);
  });

  it("ne confirme pas l’orge avant 2 200 degrés-jours", () => {
    const result = summarizeBarleyDetection(
      [{ date: "2025-01-01", tmax: 4398, tmin: 0 }],
      DEFAULT_BARLEY_DETECTION_CONFIG
    );

    expect(result.cumulativeGdd).toBe(2199);
    expect(result.isBarleyDetected).toBe(false);
  });
});
