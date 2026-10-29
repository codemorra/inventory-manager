import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";
import { AppLogo } from "../../src/components/AppLogo";

afterEach(cleanup);

test("constrains the artwork to header dimensions without relying on external CSS", () => {
  const { container } = render(<AppLogo />);
  const svg = container.querySelector("svg")!;
  expect(svg).toHaveAttribute("width", "36");
  expect(svg).toHaveAttribute("height", "36");
  expect(svg).toHaveStyle({ width: "100%", height: "100%" });
  expect(svg.parentElement).toHaveStyle({ width: "36px", height: "36px" });
});

test("uses the current accent and a theme-aware contrasting monogram", () => {
  const { container } = render(<AppLogo />);
  const shapes = [...container.querySelectorAll<SVGElement>("svg *")];
  const background = shapes.find(
    (shape) => shape.getAttribute("inkscape:label") === "background",
  )!;
  expect(background.style.fill).toBe("var(--app-accent)");
  for (const label of ["mark", "m", "i1", "i2"]) {
    const part = shapes.find(
      (shape) => shape.getAttribute("inkscape:label") === label,
    )!;
    expect(part.style.fill).toBe("var(--app-chrome)");
  }
});
