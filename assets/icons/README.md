# Application icon

`app-logo.svg` is the shared source artwork for Inventory Manager. The 512x512 `app-logo.png` and multi-resolution `app-logo.ico` are derived from it for desktop builds.

The Linux desktop window uses the PNG at runtime; both build formats include it. The frontend uses the SVG with the selected accent color applied to its background.

Keep the SVG’s Inkscape object label `background` so frontend color mapping continues to work after artwork changes.

After changing the SVG, regenerate the desktop icons with Inkscape and ImageMagick:

```bash
inkscape assets/icons/app-logo.svg --export-width=512 --export-height=512 --export-filename=assets/icons/app-logo.png
magick assets/icons/app-logo.png -define icon:auto-resize=256,128,64,48,32,24,16 assets/icons/app-logo.ico
```

Run these commands from the repository root.
