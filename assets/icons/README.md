# Application icon

`app-logo.svg` is the shared source artwork for Inventory Manager. Keep the authoritative SVG here so the frontend, browser icon and future desktop builds can use the same design.

The frontend imports this file and applies theme colors to an in-memory copy: `background` uses the selected accent, while `mark`, `m`, `i1` and `i2` use the contrasting application chrome color. These names are Inkscape object labels; retain them when editing the artwork. Geometry and opacity come from the SVG itself, and its stored colors remain the defaults for standalone use.
