import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { glyphForFamily } from "./ModelGlyph";

afterEach(cleanup);

describe("glyphForFamily", () => {
  it.each(["parakeet", "nemotron"])(
    "uses the NVIDIA glyph for %s",
    (family) => {
      render(<>{glyphForFamily(family)}</>);

      expect(screen.getByRole("img", { name: "NVIDIA" })).toBeTruthy();
    },
  );
});
