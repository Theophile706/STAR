import { describe, expect, it } from "vitest";
import { isAutomaticBarleyParcel } from "@/lib/automatic-parcels";

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
});
