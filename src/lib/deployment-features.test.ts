import { describe, expect, it } from "vitest";
import { getDeploymentFeatures } from "./deployment-features";

describe("getDeploymentFeatures", () => {
  it("defaults legacy surfaces off", () => {
    expect(getDeploymentFeatures({})).toEqual({
      feed: false,
      imessage: false,
      whatsapp: false,
    });
  });

  it("enables explicit true or one values", () => {
    expect(
      getDeploymentFeatures({
        NEXT_PUBLIC_ENABLE_FEED: "1",
        NEXT_PUBLIC_ENABLE_IMESSAGE: "true",
        NEXT_PUBLIC_ENABLE_WHATSAPP: "1",
      }),
    ).toEqual({
      feed: true,
      imessage: true,
      whatsapp: true,
    });
  });
});
