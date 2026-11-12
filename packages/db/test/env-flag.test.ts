import { afterEach, describe, expect, it } from "vitest";
import { envFlag } from "../src/env";

const NAME = "GW_TEST_FLAG";

describe("envFlag (D51)", () => {
  afterEach(() => { delete process.env[NAME]; });

  it("reads common on values, ignoring case and surrounding whitespace", () => {
    for (const value of ["1", "true", "TRUE", " true ", "yes", "on\n"]) {
      process.env[NAME] = value;
      expect(envFlag(NAME), JSON.stringify(value)).toBe(true);
    }
  });

  it("reads off values and anything else as off", () => {
    for (const value of ["0", "false", " off ", "no", "enabled"]) {
      process.env[NAME] = value;
      expect(envFlag(NAME, true), JSON.stringify(value)).toBe(false);
    }
  });

  it("uses the fallback when the value is missing or blank", () => {
    expect(envFlag(NAME, true)).toBe(true);
    process.env[NAME] = "   ";
    expect(envFlag(NAME, true)).toBe(true);
    expect(envFlag(NAME, false)).toBe(false);
  });
});
