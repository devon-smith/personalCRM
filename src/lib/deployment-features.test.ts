import { describe, expect, it } from "vitest";
import { getDeploymentFeatures } from "./deployment-features";

describe("getDeploymentFeatures", () => {
  it("defaults legacy surfaces off", () => {
    expect(getDeploymentFeatures({})).toEqual({
      imessage: false,
    });
  });

  it("enables explicit true or one values", () => {
    expect(
      getDeploymentFeatures({
        NEXT_PUBLIC_ENABLE_IMESSAGE: "true",
      }),
    ).toEqual({
      imessage: true,
    });
  });
});
