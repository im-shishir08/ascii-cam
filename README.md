# [ASCIIcam] — Live ASCII Camera

> Your face, but make it terminal.

A browser-based live ASCII art renderer powered entirely by the **HTML5 Canvas API** and your webcam. No libraries. No frameworks. No dependencies.

![ASCIIcam demo](https://i.imgur.com/placeholder.png)
<!-- Replace with a real screenshot once you run it -->

---

## Features

| Feature | Details |
|---|---|
| **Classic mode** | Phosphor-green ASCII on black — pure terminal aesthetic |
| **Color mode** | Each character inherits the original pixel color |
| **Edge detection** | Real-time Sobel filter — turns you into a sketch |
| **Detail slider** | 20–160 columns — trade performance for resolution |
| **Contrast control** | Boost or soften the image before conversion |
| **Invert toggle** | Flip the brightness ramp |
| **Mirror mode** | Selfie-friendly horizontal flip |
| **Export .txt** | Save the current frame as a plain text file |
| **Export .png** | Render the ASCII frame onto a canvas and save as image |

---

## How it works

```
Webcam → <video> → <canvas> → getImageData() → brightness → ASCII char → <pre>
```

1. **Capture** — Each frame from the webcam is drawn onto a hidden `<canvas>` scaled to the target column count.
2. **Grayscale** — Each pixel's brightness is computed using the luminance formula:  
   `L = 0.299R + 0.587G + 0.114B`
3. **Mapping** — Brightness (0–255) maps to a position in the ASCII ramp:  
   `@#&8%$WMB0QOZXYUJIlt1i!;:,. ` (dark → light)
4. **Edge detection** — A Sobel operator computes the gradient magnitude across the grayscale image, highlighting edges with block characters.
5. **Display** — Characters are injected into a `<pre>` element with a monospace font at ~7–8px.

---

## Run it locally

```bash
git clone https://github.com/YOUR_USERNAME/ascii-cam.git
cd ascii-cam
```

Then just open `index.html` in your browser.

> ⚠️ Camera access requires either `localhost` or `https://`. If you open the file directly (`file://`), the browser will block camera permissions. Use a simple local server:

```bash
# Python
python -m http.server 8080

# Node.js
npx serve .
```

Then visit `http://localhost:8080`.

---

## File structure

```
ascii-cam/
├── index.html   ← Layout and DOM structure
├── style.css    ← Terminal aesthetic, controls, responsive layout
├── app.js       ← All camera, processing, and export logic
└── README.md
```

---

## Tech used

- **getUserMedia API** — webcam access
- **Canvas 2D API** — pixel reading + PNG export
- **requestAnimationFrame** — smooth render loop
- **Blob + URL.createObjectURL** — in-browser file export
- **Sobel operator** — manual edge detection (no libs!)

---

## Possible extensions

- [ ] Add font size control in the UI
- [ ] Record a short ASCII video (WebM export)
- [ ] Add more ASCII ramps (blocks, braille, minimal)
- [ ] WebGL renderer for higher performance
- [ ] PWA support (offline, installable)

---

## License

MIT — do whatever you want with it.
