import { describe, expect, it } from "vitest";
import { getDeploymentFeatures } from "./deployment-features";

describe("getDeploymentFeatures", () => {
  it("defaults legacy surfaces off", () => {
    expect(getDeploymentFeatures({})).toEqual({
      imessage: false,
      whatsapp: false,
    });
  });

  it("enables explicit true or one values", () => {
    expect(
      getDeploymentFeatures({
        NEXT_PUBLIC_ENABLE_IMESSAGE: "true",
        NEXT_PUBLIC_ENABLE_WHATSAPP: "1",
      }),
    ).toEqual({
      imessage: true,
      whatsapp: true,
    });
  });
});
