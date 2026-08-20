import { describe, expect, it } from "vitest";
import { getDetectedBarleySegments, isAutomaticBarleyParcel } from "@/lib/automatic-parcels";

describe("automatic parcel classification", () => {
  it("identifie une analyse déclarée comme orge", () => {
    expect(isAutomaticBarleyParcel({
      id: "osm-way-1",
      coordinates: [],
      center: { lat: 0, lng: 0 },
      tags: {},
      analysis: { is_barley: true },
      analysis_error: null,
    })).toBe(true);
  });

  it("exclut explicitement les parcelles non-orge", () => {
    expect(isAutomaticBarleyParcel({
      id: "osm-way-2",
      coordinates: [],
      center: { lat: 0, lng: 0 },
      tags: {},
      analysis: { culture_detected: "Non-orge" },
      analysis_error: null,
    })).toBe(false);
  });

  it("retient uniquement les objets SNIC avec une géométrie exploitable", () => {
    const segments = getDetectedBarleySegments({
      id: "osm-way-3",
      coordinates: [],
      center: { lat: 0, lng: 0 },
      tags: {},
      analysis: {
        detected_segments: [
          {
            coordinates: [{ lat: 1, lng: 1 }, { lat: 1, lng: 2 }, { lat: 2, lng: 1 }],
            confidence: 92,
            ndvi: 0.63,
            area_ha: 4.5,
          },
          {
            coordinates: [{ lat: 1, lng: 1 }],
            confidence: 80,
            ndvi: 0.5,
            area_ha: 1,
          },
        ],
      },
      analysis_error: null,
    });

    expect(segments).toHaveLength(1);
    expect(segments[0].confidence).toBe(92);
  });
});
