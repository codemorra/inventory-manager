import { useMemo } from "react";
import logo from "../../../assets/icons/app-logo.svg?raw";

/**
 * Prepare an in-memory SVG copy with fixed display dimensions and live theme colors.
 * @returns SVG markup retaining the original geometry and layer opacity.
 */
function prepareLogo() {
  const document = new DOMParser().parseFromString(logo, "image/svg+xml");
  const svg = document.documentElement;
  svg.setAttribute("width", "36");
  svg.setAttribute("height", "36");
  svg.setAttribute("style", "display:block;width:100%;height:100%");
  for (const element of svg.querySelectorAll<SVGElement>("*")) {
    const label = element.getAttribute("inkscape:label");
    if (label === "background") {
      element.style.setProperty(
        "fill",
        "var(--app-logo-background)",
        "important",
      );
    }
  }
  return new XMLSerializer().serializeToString(svg);
}

/**
 * Display a themed copy of the trusted, bundled artwork without changing its source file.
 * @returns The decorative application logo constrained to its header dimensions.
 */
export function AppLogo() {
  const markup = useMemo(() => prepareLogo(), []);
  return (
    <span
      aria-hidden="true"
      className="block size-9 shrink-0"
      style={{ width: 36, height: 36 }}
      dangerouslySetInnerHTML={{ __html: markup }}
    />
  );
}
