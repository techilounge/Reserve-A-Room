import { describe, expect, it } from "vitest";

import nextConfig from "../../../next.config";

describe("Server Action security configuration", () => {
  it("caps action request bodies at 16 KB", () => {
    expect(nextConfig.experimental?.serverActions?.bodySizeLimit).toBe("16kb");
  });
});
