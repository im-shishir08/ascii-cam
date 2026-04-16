/**
 * ASCIIcam — app.js  (v2 — clarity upgrade)
 *
 * Improvements over v1:
 *  - Adaptive histogram stretch: auto-expands brightness range per frame
 *    so dim or bright rooms always use the full character ramp
 *  - Unsharp mask (sharpening): makes edges between face/background pop
 *  - Gamma correction: boosts midtone separation (skin, hair, shadow)
 *  - Better ASCII ramp: hand-tuned for face readability
 *  - Pre-built gamma LUT (lookup table) for fast per-pixel mapping
 */

// ─────────────────────────────────────────
// 1. DOM references
// ─────────────────────────────────────────
const video          = document.getElementById('video');
const captureCanvas  = document.getElementById('capture-canvas');
const ctx            = captureCanvas.getContext('2d', { willReadFrequently: true });
const asciiOutput    = document.getElementById('ascii-output');
const startOverlay   = document.getElementById('start-overlay');
const fpsCounter     = document.getElementById('fps-counter');
const screenInner    = document.querySelector('.screen-inner');

const btnStart       = document.getElementById('btn-start');
const btnStop        = document.getElementById('btn-stop');
const btnRecord      = document.getElementById('btn-record');
const btnClassic     = document.getElementById('btn-classic');
const btnColor       = document.getElementById('btn-color');
const btnAscii       = document.getElementById('btn-ascii');
const btnEdge        = document.getElementById('btn-edge');
const sliderDetail   = document.getElementById('slider-detail');
const sliderContrast = document.getElementById('slider-contrast');
const sliderSharpen  = document.getElementById('slider-sharpen');
const sliderGamma    = document.getElementById('slider-gamma');
const detailVal      = document.getElementById('detail-val');
const contrastVal    = document.getElementById('contrast-val');
const sharpenVal     = document.getElementById('sharpen-val');
const gammaVal       = document.getElementById('gamma-val');
const chkInvert      = document.getElementById('chk-invert');
const chkMirror      = document.getElementById('chk-mirror');
const btnSnapTxt     = document.getElementById('btn-snap-txt');
const btnSnapPng     = document.getElementById('btn-snap-png');
const colorWheel     = document.getElementById('color-wheel');
const colorSwatch    = document.getElementById('color-swatch');
const colorHex       = document.getElementById('color-hex');
const btnColorReset  = document.getElementById('btn-color-reset');
const btnFullscreen  = document.getElementById('btn-fullscreen');
const screenBezel    = document.querySelector('.screen-bezel');
// Fullscreen HUD
const fsHud          = document.getElementById('fs-hud');
const fsBtnRecord    = document.getElementById('fs-btn-record');
const fsBtnPng       = document.getElementById('fs-btn-png');
const fsBtnTxt       = document.getElementById('fs-btn-txt');
const fsBtnExit      = document.getElementById('fs-btn-exit');

// ─────────────────────────────────────────
// 2. State
// ─────────────────────────────────────────
const state = {
  running:    false,
  mode:       'classic',
  render:     'ascii',
  cols:       160,
  contrast:   200,
  sharpen:    5,
  gamma:      2.5,
  invert:     true,
  mirror:     true,
  animId:     null,
  lastTime:   0,
  frameCount: 0,
  gammaLUT:   null,
  asciiColor: '#39ff14',
  // Recording
  mediaRecorder: null,
  recordChunks:  [],
  recording:     false,
};

// ASCII ramp — darkest to lightest, tuned for face detail
const ASCII_RAMP = '$@B%8&WM#*oahkbdpqwmZO0QLCJUYXzcvunxrjft/\\|()1{}[]?-_+~<>i!lI;:,"^`\'. ';
const EDGE_CHARS = ['█', '▓', '▒', '░', '·', ' '];

// ─────────────────────────────────────────
// 3. Gamma LUT
// Precomputes 256 values so we don't call
// Math.pow() on every pixel every frame.
// ─────────────────────────────────────────
function buildGammaLUT(gamma) {
  const lut = new Uint8Array(256);
  for (let i = 0; i < 256; i++) {
    lut[i] = Math.round(Math.pow(i / 255, gamma) * 255);
  }
  state.gammaLUT = lut;
}
buildGammaLUT(2.5);

// ─────────────────────────────────────────
// 4. Camera
// ─────────────────────────────────────────
async function startCamera() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: 'user',
        width:  { ideal: 1280 },
        height: { ideal: 720 },
        frameRate: { ideal: 30 },
      },
      audio: false,
    });
    video.srcObject = stream;
    await video.play();

    state.running = true;
    startOverlay.classList.add('hidden');
    screenInner.classList.add('active');
    btnStart.classList.add('hidden');
    btnStop.classList.remove('hidden');
    scheduleFrame();
  } catch (err) {
    alert('Camera access denied or not available.\n\n' + err.message);
  }
}

function stopCamera() {
  state.running = false;
  cancelAnimationFrame(state.animId);
  const stream = video.srcObject;
  if (stream) stream.getTracks().forEach(t => t.stop());
  video.srcObject = null;
  asciiOutput.textContent = '';
  screenInner.classList.remove('active');
  startOverlay.classList.remove('hidden');
  btnStart.classList.remove('hidden');
  btnStop.classList.add('hidden');
  fpsCounter.textContent = '0';
}

// ─────────────────────────────────────────
// 5. Render loop
// ─────────────────────────────────────────
function scheduleFrame() {
  state.animId = requestAnimationFrame(renderFrame);
}

function renderFrame(timestamp) {
  if (!state.running) return;

  state.frameCount++;
  if (timestamp - state.lastTime >= 1000) {
    fpsCounter.textContent = state.frameCount;
    state.frameCount = 0;
    state.lastTime   = timestamp;
  }

  const cols      = state.cols;
  const charAspect = 2.0;
  const vidAspect  = video.videoWidth / video.videoHeight || 16 / 9;
  const rows       = Math.floor(cols / vidAspect / charAspect);

  captureCanvas.width  = cols;
  captureCanvas.height = rows;

  ctx.save();
  if (state.mirror) {
    ctx.translate(cols, 0);
    ctx.scale(-1, 1);
  }
  ctx.drawImage(video, 0, 0, cols, rows);
  ctx.restore();

  const imageData = ctx.getImageData(0, 0, cols, rows);
  const pixels    = imageData.data;

  // Processing pipeline:
  // raw pixels → grayscale+contrast → sharpen → gamma → stretch
  const gray      = buildGray(pixels, cols * rows);
  const sharp     = state.sharpen > 0 ? unsharpMask(gray, cols, rows, state.sharpen) : gray;
  const gammaCorrected = applyGammaLUT(sharp, state.gammaLUT);
  const stretched = adaptiveStretch(gammaCorrected);

  if (state.render === 'ascii') {
    renderASCII(pixels, stretched, cols, rows);
  } else {
    renderEdge(sharp, cols, rows);
  }

  paintRecordFrame();
  scheduleFrame();
}

// ─────────────────────────────────────────
// 6. Image processing
// ─────────────────────────────────────────

function buildGray(pixels, count) {
  const gray     = new Float32Array(count);
  const contrast = state.contrast / 100;
  for (let i = 0; i < count; i++) {
    const p = i * 4;
    let r = clamp((pixels[p]   - 128) * contrast + 128);
    let g = clamp((pixels[p+1] - 128) * contrast + 128);
    let b = clamp((pixels[p+2] - 128) * contrast + 128);
    gray[i] = 0.299 * r + 0.587 * g + 0.114 * b;
  }
  return gray;
}

/**
 * Unsharp mask — sharpens by amplifying the difference
 * between the original and a blurred version.
 * This makes your face pop against the background.
 * amount 1 = subtle, 5 = very strong
 */
function unsharpMask(gray, cols, rows, amount) {
  const blurred  = boxBlur(gray, cols, rows);
  const sharp    = new Float32Array(gray.length);
  const strength = amount * 0.5;
  for (let i = 0; i < gray.length; i++) {
    sharp[i] = clamp(gray[i] + strength * (gray[i] - blurred[i]));
  }
  return sharp;
}

/** Separable 3×3 box blur */
function boxBlur(gray, cols, rows) {
  const tmp = new Float32Array(gray.length);
  const out = new Float32Array(gray.length);

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const l = col > 0        ? gray[row*cols + col - 1] : gray[row*cols + col];
      const c =                  gray[row*cols + col];
      const r = col < cols - 1 ? gray[row*cols + col + 1] : gray[row*cols + col];
      tmp[row*cols + col] = (l + c + r) / 3;
    }
  }

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const t = row > 0        ? tmp[(row-1)*cols + col] : tmp[row*cols + col];
      const c =                  tmp[ row   *cols + col];
      const b = row < rows - 1 ? tmp[(row+1)*cols + col] : tmp[row*cols + col];
      out[row*cols + col] = (t + c + b) / 3;
    }
  }

  return out;
}

function applyGammaLUT(gray, lut) {
  const out = new Float32Array(gray.length);
  for (let i = 0; i < gray.length; i++) {
    out[i] = lut[Math.round(gray[i])];
  }
  return out;
}

/**
 * Adaptive histogram stretch:
 * Finds the actual darkest and brightest pixel this frame
 * and maps them to 0 and 255.
 * Works in any lighting — dark room, bright window, outside.
 */
function adaptiveStretch(gray) {
  let min = 255, max = 0;
  for (let i = 0; i < gray.length; i++) {
    if (gray[i] < min) min = gray[i];
    if (gray[i] > max) max = gray[i];
  }
  const range = max - min || 1;
  const out   = new Float32Array(gray.length);
  for (let i = 0; i < gray.length; i++) {
    out[i] = ((gray[i] - min) / range) * 255;
  }
  return out;
}

// ─────────────────────────────────────────
// 7. ASCII render
// ─────────────────────────────────────────
function renderASCII(pixels, gray, cols, rows) {
  const ramp    = ASCII_RAMP;
  const rampLen = ramp.length - 1;
  const invert  = state.invert;

  if (state.mode === 'color') {
    let html = '';
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const idx = row * cols + col;
        let b = gray[idx] / 255;
        if (invert) b = 1 - b;
        const ch = ramp[Math.min(Math.floor(b * rampLen), rampLen)];
        const p  = idx * 4;
        const safe = ch === ' ' ? '&nbsp;' : escHtml(ch);
        html += `<span style="color:rgb(${pixels[p]},${pixels[p+1]},${pixels[p+2]})">${safe}</span>`;
      }
      html += '\n';
    }
    asciiOutput.innerHTML = html;
    asciiOutput.classList.add('color-mode');
  } else {
    let text = '';
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        let b = gray[row * cols + col] / 255;
        if (invert) b = 1 - b;
        text += ramp[Math.min(Math.floor(b * rampLen), rampLen)];
      }
      text += '\n';
    }
    asciiOutput.textContent = text;
    asciiOutput.classList.remove('color-mode');
  }
}

// ─────────────────────────────────────────
// 8. Edge render (Sobel)
// ─────────────────────────────────────────
function renderEdge(gray, cols, rows) {
  const mag  = new Float32Array(cols * rows);
  let maxMag = 0;

  for (let row = 1; row < rows - 1; row++) {
    for (let col = 1; col < cols - 1; col++) {
      const tl = gray[(row-1)*cols+(col-1)], tc = gray[(row-1)*cols+col], tr = gray[(row-1)*cols+(col+1)];
      const ml = gray[ row   *cols+(col-1)],                              mr = gray[ row   *cols+(col+1)];
      const bl = gray[(row+1)*cols+(col-1)], bc = gray[(row+1)*cols+col], br = gray[(row+1)*cols+(col+1)];
      const gx = -tl - 2*ml - bl + tr + 2*mr + br;
      const gy = -tl - 2*tc - tr + bl + 2*bc + br;
      const m  = Math.sqrt(gx*gx + gy*gy);
      mag[row*cols+col] = m;
      if (m > maxMag) maxMag = m;
    }
  }

  const chars   = EDGE_CHARS;
  const charLen = chars.length - 1;
  const invert  = state.invert;
  let text = '';

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      let norm = maxMag > 0 ? mag[row*cols+col] / maxMag : 0;
      if (invert) norm = 1 - norm;
      text += chars[Math.min(Math.floor(norm * charLen), charLen)];
    }
    text += '\n';
  }

  asciiOutput.textContent = text;
  asciiOutput.classList.remove('color-mode');
}

// ─────────────────────────────────────────
// 9. Helpers
// ─────────────────────────────────────────
function clamp(v) { return v < 0 ? 0 : v > 255 ? 255 : v; }
function escHtml(ch) {
  return ch === '&' ? '&amp;' : ch === '<' ? '&lt;' : ch === '>' ? '&gt;' : ch;
}

// ─────────────────────────────────────────
// 10. Export
// ─────────────────────────────────────────
function exportTxt() {
  const text = asciiOutput.textContent;
  if (!text.trim()) { alert('Start the camera first!'); return; }
  const a = Object.assign(document.createElement('a'), {
    href: URL.createObjectURL(new Blob([text], { type: 'text/plain' })),
    download: `asciicam_${ts()}.txt`,
  });
  a.click();
}

function exportPng() {
  const lines = asciiOutput.textContent.split('\n').filter(Boolean);
  if (!lines.length) { alert('Start the camera first!'); return; }

  const fs = 8, lh = fs * 1.15, cw = fs * 0.601, px = 12, py = 12;
  const ec = Object.assign(
    document.createElement('canvas'),
    { width: Math.round(lines[0].length * cw + px * 2), height: Math.round(lines.length * lh + py * 2) }
  ).getContext('2d');

  ec.fillStyle = '#000'; ec.fillRect(0, 0, ec.canvas.width, ec.canvas.height);
  ec.font = `${fs}px 'Share Tech Mono', monospace`;
  ec.fillStyle = '#39ff14'; ec.textBaseline = 'top';
  lines.forEach((line, i) => ec.fillText(line, px, py + i * lh));

  ec.canvas.toBlob(blob => {
    Object.assign(document.createElement('a'), {
      href: URL.createObjectURL(blob),
      download: `asciicam_${ts()}.png`,
    }).click();
  }, 'image/png');
}

function ts() {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
}

// ─────────────────────────────────────────
// 11. Video Recording (ASCII rendered to canvas → WebM)
// ─────────────────────────────────────────

// Off-screen canvas we'll stream from
const recCanvas = document.createElement('canvas');
const recCtx    = recCanvas.getContext('2d');

function startRecording() {
  if (!state.running) { alert('Start the camera first!'); return; }
  if (state.recording) { stopRecording(); return; }

  // Size the recording canvas to match current ASCII output dimensions
  const fs   = 7.5, lh = fs * 1.15, cw = fs * 0.601;
  const lines = asciiOutput.textContent.split('\n');
  const cols  = lines[0]?.length || state.cols;
  const rows  = lines.length;
  recCanvas.width  = Math.round(cols * cw);
  recCanvas.height = Math.round(rows * lh);

  // Check MediaRecorder support
  const mimeType = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm']
    .find(m => MediaRecorder.isTypeSupported(m)) || '';

  const stream = recCanvas.captureStream(30);
  state.mediaRecorder = new MediaRecorder(stream, mimeType ? { mimeType } : {});
  state.recordChunks  = [];

  state.mediaRecorder.ondataavailable = e => {
    if (e.data.size > 0) state.recordChunks.push(e.data);
  };

  state.mediaRecorder.onstop = () => {
    const blob = new Blob(state.recordChunks, { type: 'video/webm' });
    Object.assign(document.createElement('a'), {
      href: URL.createObjectURL(blob),
      download: `asciicam_${ts()}.webm`,
    }).click();
    state.recording = false;
    updateRecordBtns();
  };

  state.mediaRecorder.start(100); // collect chunks every 100ms
  state.recording = true;
  updateRecordBtns();
}

function stopRecording() {
  if (state.mediaRecorder && state.recording) {
    state.mediaRecorder.stop();
  }
}

// Draw current ASCII frame onto the recording canvas each render cycle
function paintRecordFrame() {
  if (!state.recording) return;
  const lines = asciiOutput.textContent.split('\n');
  if (!lines.length) return;

  const fs = 7.5, lh = fs * 1.15, cw = fs * 0.601;
  const cols = lines[0]?.length || state.cols;
  const rows = lines.length;

  // Resize if needed
  if (recCanvas.width !== Math.round(cols * cw) || recCanvas.height !== Math.round(rows * lh)) {
    recCanvas.width  = Math.round(cols * cw);
    recCanvas.height = Math.round(rows * lh);
  }

  recCtx.fillStyle = '#000';
  recCtx.fillRect(0, 0, recCanvas.width, recCanvas.height);
  recCtx.font = `${fs}px 'Share Tech Mono', monospace`;
  recCtx.fillStyle = state.asciiColor;
  recCtx.textBaseline = 'top';
  lines.forEach((line, i) => recCtx.fillText(line, 0, i * lh));
}

function updateRecordBtns() {
  const isRec = state.recording;
  btnRecord.textContent    = isRec ? '⏹ Stop Rec' : '⏺ Record Video';
  fsBtnRecord.textContent  = isRec ? '⏹ Stop'     : '⏺ Record';
  btnRecord.classList.toggle('recording', isRec);
  fsBtnRecord.classList.toggle('recording', isRec);
}


// ─────────────────────────────────────────
// 12. Event listeners
// ─────────────────────────────────────────
btnStart.addEventListener('click', startCamera);
btnStop.addEventListener('click', stopCamera);
startOverlay.addEventListener('click', startCamera);
btnRecord.addEventListener('click', () => state.recording ? stopRecording() : startRecording());
fsBtnRecord.addEventListener('click', () => state.recording ? stopRecording() : startRecording());
fsBtnPng.addEventListener('click', exportPng);
fsBtnTxt.addEventListener('click', exportTxt);
fsBtnExit.addEventListener('click', exitFullscreen);

[btnClassic, btnColor].forEach(btn => btn.addEventListener('click', () => {
  state.mode = btn.dataset.mode;
  btnClassic.classList.toggle('active', state.mode === 'classic');
  btnColor.classList.toggle('active',   state.mode === 'color');
}));

[btnAscii, btnEdge].forEach(btn => btn.addEventListener('click', () => {
  state.render = btn.dataset.render;
  btnAscii.classList.toggle('active', state.render === 'ascii');
  btnEdge.classList.toggle('active',  state.render === 'edge');
}));

sliderDetail.addEventListener('input', () => {
  state.cols = parseInt(sliderDetail.value, 10);
  detailVal.textContent = state.cols;
});

sliderContrast.addEventListener('input', () => {
  state.contrast = parseInt(sliderContrast.value, 10);
  contrastVal.textContent = state.contrast;
});

sliderSharpen.addEventListener('input', () => {
  state.sharpen = parseInt(sliderSharpen.value, 10);
  sharpenVal.textContent = state.sharpen;
});

sliderGamma.addEventListener('input', () => {
  state.gamma = parseInt(sliderGamma.value, 10) / 10;
  gammaVal.textContent = state.gamma.toFixed(1);
  buildGammaLUT(state.gamma);
});

chkInvert.addEventListener('change', () => { state.invert = chkInvert.checked; });
chkMirror.addEventListener('change', () => { state.mirror = chkMirror.checked; });
btnSnapTxt.addEventListener('click', exportTxt);
btnSnapPng.addEventListener('click', exportPng);

// ─────────────────────────────────────────
// 12. Color Wheel
// ─────────────────────────────────────────
(function initColorWheel() {
  const wCtx = colorWheel.getContext('2d');
  const W = colorWheel.width, H = colorWheel.height;
  const cx = W / 2, cy = H / 2, r = W / 2 - 2;

  // Draw hue ring
  for (let angle = 0; angle < 360; angle++) {
    const startAngle = (angle - 1) * Math.PI / 180;
    const endAngle   = (angle + 1) * Math.PI / 180;
    const grad = wCtx.createRadialGradient(cx, cy, 0, cx, cy, r);
    grad.addColorStop(0,   `hsl(${angle},0%,100%)`);
    grad.addColorStop(0.5, `hsl(${angle},100%,50%)`);
    grad.addColorStop(1,   `hsl(${angle},100%,10%)`);
    wCtx.beginPath();
    wCtx.moveTo(cx, cy);
    wCtx.arc(cx, cy, r, startAngle, endAngle);
    wCtx.closePath();
    wCtx.fillStyle = grad;
    wCtx.fill();
  }

  // Center brightness overlay
  const centerGrad = wCtx.createRadialGradient(cx, cy, 0, cx, cy, r * 0.38);
  centerGrad.addColorStop(0, 'rgba(255,255,255,1)');
  centerGrad.addColorStop(1, 'rgba(255,255,255,0)');
  wCtx.beginPath();
  wCtx.arc(cx, cy, r * 0.38, 0, Math.PI * 2);
  wCtx.fillStyle = centerGrad;
  wCtx.fill();

  function pickColor(e) {
    const rect = colorWheel.getBoundingClientRect();
    const scaleX = W / rect.width;
    const scaleY = H / rect.height;
    const x = (e.clientX - rect.left) * scaleX;
    const y = (e.clientY - rect.top)  * scaleY;
    const dx = x - cx, dy = y - cy;
    if (dx * dx + dy * dy > r * r) return; // outside circle
    const [rr, gg, bb] = wCtx.getImageData(Math.round(x), Math.round(y), 1, 1).data;
    const hex = '#' + [rr, gg, bb].map(v => v.toString(16).padStart(2, '0')).join('');
    state.asciiColor = hex;
    asciiOutput.style.color = hex;
    asciiOutput.style.textShadow = `0 0 4px ${hex}88`;
    colorSwatch.style.background = hex;
    colorHex.textContent = hex;
  }

  let dragging = false;
  colorWheel.addEventListener('mousedown', e => { dragging = true; pickColor(e); });
  colorWheel.addEventListener('mousemove', e => { if (dragging) pickColor(e); });
  window.addEventListener('mouseup', () => { dragging = false; });
  colorWheel.addEventListener('touchstart', e => { pickColor(e.touches[0]); }, { passive: true });
  colorWheel.addEventListener('touchmove',  e => { pickColor(e.touches[0]); e.preventDefault(); }, { passive: false });

  // Reset button
  btnColorReset.addEventListener('click', () => {
    state.asciiColor = '#39ff14';
    asciiOutput.style.color = '#39ff14';
    asciiOutput.style.textShadow = '0 0 4px rgba(57,255,20,0.5)';
    colorSwatch.style.background = '#39ff14';
    colorHex.textContent = '#39ff14';
  });

  // Init swatch
  colorSwatch.style.background = state.asciiColor;
  colorHex.textContent = state.asciiColor;
})();

// ─────────────────────────────────────────
// 13. Fullscreen (native Fullscreen API)
// ─────────────────────────────────────────
function enterFullscreen() {
  const el = screenInner;
  if (el.requestFullscreen)            el.requestFullscreen();
  else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();
  else if (el.mozRequestFullScreen)    el.mozRequestFullScreen();
  else if (el.msRequestFullscreen)     el.msRequestFullscreen();
}

function exitFullscreen() {
  if (document.exitFullscreen)            document.exitFullscreen();
  else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
  else if (document.mozCancelFullScreen)  document.mozCancelFullScreen();
  else if (document.msExitFullscreen)     document.msExitFullscreen();
}

function isFullscreen() {
  return !!(document.fullscreenElement || document.webkitFullscreenElement ||
            document.mozFullScreenElement || document.msFullscreenElement);
}

btnFullscreen.addEventListener('click', () => {
  if (isFullscreen()) exitFullscreen();
  else enterFullscreen();
});

document.addEventListener('fullscreenchange',       updateFullscreenBtn);
document.addEventListener('webkitfullscreenchange', updateFullscreenBtn);
document.addEventListener('mozfullscreenchange',    updateFullscreenBtn);

function updateFullscreenBtn() {
  if (isFullscreen()) {
    btnFullscreen.textContent = '⛶ Exit Fullscreen';
    state._prevCols = state.cols;
    const charWidth = 7.5 * 0.601;
    state.cols = Math.max(160, Math.floor(window.screen.width / charWidth));
    fsHud.classList.remove('hidden');
    showHudTemporarily();
  } else {
    btnFullscreen.textContent = '⛶ Fullscreen';
    if (state._prevCols) { state.cols = state._prevCols; state._prevCols = null; }
    fsHud.classList.add('hidden');
    fsHud.classList.remove('visible');
  }
}

// Auto-hide HUD after 3s of no mouse movement in fullscreen
let hudHideTimer = null;
function showHudTemporarily() {
  fsHud.classList.add('visible');
  clearTimeout(hudHideTimer);
  hudHideTimer = setTimeout(() => {
    if (!fsHud.matches(':hover')) fsHud.classList.remove('visible');
  }, 3000);
}

screenInner.addEventListener('mousemove', () => {
  if (isFullscreen()) showHudTemporarily();
});
fsHud.addEventListener('mouseenter', () => clearTimeout(hudHideTimer));
fsHud.addEventListener('mouseleave', () => {
  hudHideTimer = setTimeout(() => fsHud.classList.remove('visible'), 1500);
});

// F key shortcut
document.addEventListener('keydown', e => {
  if ((e.key === 'f' || e.key === 'F') && document.activeElement.tagName !== 'INPUT') {
    if (isFullscreen()) exitFullscreen(); else enterFullscreen();
  }
});

// Init display values
detailVal.textContent   = sliderDetail.value;
contrastVal.textContent = sliderContrast.value;
sharpenVal.textContent  = sliderSharpen.value;
gammaVal.textContent    = (parseInt(sliderGamma.value) / 10).toFixed(1);