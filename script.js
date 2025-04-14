const canvas = document.getElementById('pixelCanvas');
const ctx = canvas.getContext('2d');
const infoDiv = document.getElementById('info');
const controlsDiv = document.getElementById('controls');
const brushSelectors = controlsDiv.querySelectorAll('.brush-selector');
const colorSelectors = controlsDiv.querySelectorAll('.color-selector');

// --- Configuration ---
const GRID_SIZE = 256;
const COLOR1 = '#000000'; // Black
const COLOR2 = '#FFFFFF'; // White
const COLORS = [COLOR1, COLOR2];
const DEBOUNCE_DELAY = 500;
const URL_PARAM = '#d=';

// Brush definitions (key, size, radius squared for circle check)
const BRUSHES = {
    small: { size: 2, radiusSq: 1.1 }, // 2x2 "circle" approx - fills the 2x2 block effectively
    medium: { size: 5, radiusSq: 2.5 * 2.5 }, // 5x5 circle
    large: { size: 9, radiusSq: 4.5 * 4.5 }  // 9x9 circle
};

// --- State ---
let gridData = []; // 2D array GRID_SIZE x GRID_SIZE, stores 0 or 1
let currentBrushKey = 'small'; // Default brush
let currentColorIndex = 0; // Start with COLOR1 (black)
let canvasSize = 0;
let cellSize = 0;
let updateUrlTimeout;
let isDrawing = false;

// --- Base64 & Bit Packing (Copied from previous version - unchanged) ---
const BASE64_URL_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

function uint8ArrayToBase64Url(bytes) {
    let base64 = '';
    let i = 0;
    const len = bytes.length;
    let byte1, byte2, byte3;
    while (i < len) {
        byte1 = bytes[i++];
        byte2 = (i < len) ? bytes[i++] : NaN;
        byte3 = (i < len) ? bytes[i++] : NaN;
        base64 += BASE64_URL_CHARS.charAt(byte1 >> 2);
        base64 += BASE64_URL_CHARS.charAt(((byte1 & 3) << 4) | (byte2 >> 4));
        if (!isNaN(byte2)) {
            base64 += BASE64_URL_CHARS.charAt(((byte2 & 15) << 2) | (byte3 >> 6));
            if (!isNaN(byte3)) {
                base64 += BASE64_URL_CHARS.charAt(byte3 & 63);
            }
        }
    }
    return base64;
}

function base64UrlToUint8Array(base64Url) {
    const lookup = {};
    for (let i = 0; i < BASE64_URL_CHARS.length; i++) { lookup[BASE64_URL_CHARS[i]] = i; }
    const len = base64Url.length;
    let bytes = [];
    let i = 0;
    let p = 0;
    let encoded1, encoded2, encoded3, encoded4;
    while (i < len) {
        encoded1 = lookup[base64Url[i++]];
        encoded2 = lookup[base64Url[i++]];
        encoded3 = lookup[base64Url[i++]];
        encoded4 = lookup[base64Url[i++]];
        if (encoded1 === undefined || encoded2 === undefined) { throw new Error("Invalid Base64 string"); }
        bytes[p++] = (encoded1 << 2) | (encoded2 >> 4);
        if (encoded3 !== undefined) {
            bytes[p++] = ((encoded2 & 15) << 4) | (encoded3 >> 2);
            if (encoded4 !== undefined) {
                bytes[p++] = ((encoded3 & 3) << 6) | encoded4;
            }
        }
    }
    return new Uint8Array(bytes);
}

function packGridData(data) {
    const totalPixels = GRID_SIZE * GRID_SIZE;
    const packedLength = Math.ceil(totalPixels / 8);
    const packed = new Uint8Array(packedLength);
    let byteIndex = 0;
    let bitIndex = 0;
    for (let y = 0; y < GRID_SIZE; y++) {
        for (let x = 0; x < GRID_SIZE; x++) {
            if (data[y][x] === 1) { // Store 1s (White)
                 packed[byteIndex] |= (1 << (7 - bitIndex));
            } // 0s (Black) remain 0
            bitIndex++;
            if (bitIndex === 8) { bitIndex = 0; byteIndex++; }
        }
    }
    return packed;
}

function unpackGridData(packed) {
    const newGridData = Array(GRID_SIZE).fill(0).map(() => Array(GRID_SIZE).fill(0)); // Default to black now
    const totalPixels = GRID_SIZE * GRID_SIZE;
    let pixelCount = 0;
    let byteIndex = 0;
    let bitIndex = 0;
    while (pixelCount < totalPixels && byteIndex < packed.length) {
        const currentByte = packed[byteIndex];
        const bitValue = (currentByte >> (7 - bitIndex)) & 1;
        const y = Math.floor(pixelCount / GRID_SIZE);
        const x = pixelCount % GRID_SIZE;
        newGridData[y][x] = bitValue; // 0 or 1
        pixelCount++;
        bitIndex++;
        if (bitIndex === 8) { bitIndex = 0; byteIndex++; }
    }
     if (pixelCount !== totalPixels) { console.warn(`Pixel count mismatch after unpacking: ${pixelCount}/${totalPixels}.`); }
     // Fill remaining with default (0 = Black)
     while(pixelCount < totalPixels) {
        const y = Math.floor(pixelCount / GRID_SIZE);
        const x = pixelCount % GRID_SIZE;
        if(y < GRID_SIZE && x < GRID_SIZE) newGridData[y][x] = 0;
        pixelCount++;
     }
    return newGridData;
}

// --- UI Update Functions ---
function updateBrushSelectionUI() {
    brushSelectors.forEach(btn => {
        if (btn.dataset.brush === currentBrushKey) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });
}

function updateColorSelectionUI() {
    colorSelectors.forEach(swatch => {
        // Set background for visualization
        const index = parseInt(swatch.dataset.colorIndex);
        swatch.style.backgroundColor = COLORS[index];

        // Set active class
        if (index === currentColorIndex) {
            swatch.classList.add('active');
        } else {
            swatch.classList.remove('active');
        }
    });
}

// --- Canvas Drawing ---

function setupCanvas() {
    const controlsHeight = controlsDiv.offsetHeight + 20; // Get actual height + margin
    const availableHeight = window.innerHeight - infoDiv.offsetHeight - controlsHeight;
    canvasSize = Math.min(window.innerWidth * 0.95, availableHeight * 0.95);
    cellSize = Math.max(1, Math.floor(canvasSize / GRID_SIZE));
    canvasSize = cellSize * GRID_SIZE;

    canvas.width = GRID_SIZE;
    canvas.height = GRID_SIZE;
    canvas.style.width = `${canvasSize}px`;
    canvas.style.height = `${canvasSize}px`;
    ctx.imageSmoothingEnabled = false;

    if (gridData.length === 0) {
        console.log("Initializing empty grid (all black).");
         // Initialize with black (0) to match unpack default
        gridData = Array(GRID_SIZE).fill(0).map(() => Array(GRID_SIZE).fill(0));
    }
    redrawCanvas();
}

function redrawCanvas() {
    // Faster clear: fill with one color, then draw the other
    const bgColorIndex = 1; // White background fill
    const fgColorIndex = 0; // Black foreground pixels
    ctx.fillStyle = COLORS[bgColorIndex];
    ctx.fillRect(0, 0, GRID_SIZE, GRID_SIZE);

    ctx.fillStyle = COLORS[fgColorIndex];
    let drawCount = 0;
    for (let y = 0; y < GRID_SIZE; y++) {
        for (let x = 0; x < GRID_SIZE; x++) {
            if (gridData[y][x] === fgColorIndex) {
                ctx.fillRect(x, y, 1, 1);
                drawCount++;
            }
        }
    }
    console.log(`Canvas redrawn. ${drawCount} foreground pixels.`);
}


function applyBrush(gridX, gridY) {
    const brush = BRUSHES[currentBrushKey];
    const size = brush.size;
    const radiusSq = brush.radiusSq;
    const drawColor = currentColorIndex; // Color to draw WITH

    // Calculate brush bounds
    const halfSizeFloor = Math.floor(size / 2);
    const startX = gridX - halfSizeFloor;
    const startY = gridY - halfSizeFloor;
    const endX = startX + size;
    const endY = startY + size;

    let dataChanged = false;

    // Set fill style ONCE before the loop
    ctx.fillStyle = COLORS[drawColor];

    for (let py = startY; py < endY; py++) {
        for (let px = startX; px < endX; px++) {
            // 1. Bounds check
            if (px >= 0 && px < GRID_SIZE && py >= 0 && py < GRID_SIZE) {

                // 2. Shape check (circle)
                let shouldDraw = true;
                if (size > 2) { // Only do distance check for non-small brushes
                    const distX = px - gridX;
                    const distY = py - gridY;
                    const distSq = distX * distX + distY * distY;
                    if (distSq > radiusSq) {
                         shouldDraw = false;
                    }
                }
                // For size 2, we always draw the 2x2 block (shouldDraw remains true)

                // 3. Apply if inside shape and color needs changing
                if (shouldDraw && gridData[py][px] !== drawColor) {
                    gridData[py][px] = drawColor;
                    ctx.fillRect(px, py, 1, 1); // Draw the single pixel on canvas
                    dataChanged = true;
                }
            }
        }
    }

    // 4. Schedule URL update if anything actually changed
    if (dataChanged) {
        scheduleUrlUpdate();
    }
}


// --- URL Handling (Unchanged from previous version) ---

function scheduleUrlUpdate() {
    clearTimeout(updateUrlTimeout);
    updateUrlTimeout = setTimeout(updateUrl, DEBOUNCE_DELAY);
}

function updateUrl() {
    try {
        console.time("Compression");
        const packedData = packGridData(gridData);
        const compressedData = pako.deflate(packedData, { level: 1 }); // Use level 1 for speed
        const encodedData = uint8ArrayToBase64Url(compressedData);
        console.timeEnd("Compression");

        window.location.hash = URL_PARAM + encodedData;
        infoDiv.textContent = `URL Length: ${encodedData.length} chars`;
        // console.log("URL Updated. Length:", encodedData.length);

    } catch (error) {
        console.error("Error during URL update:", error);
        infoDiv.textContent = "Error generating URL!";
    }
}

function loadFromUrl() {
    let dataStr = '';
    if (window.location.hash && window.location.hash.startsWith(URL_PARAM)) {
        dataStr = window.location.hash.substring(URL_PARAM.length);
    }

    if (dataStr) {
        console.log("Loading data from URL hash...");
        infoDiv.textContent = `Loading (${dataStr.length} chars)...`;
        try {
            console.time("Decompression");
            const compressedData = base64UrlToUint8Array(dataStr);
            const packedData = pako.inflate(compressedData);
            const expectedPackedSize = Math.ceil(GRID_SIZE * GRID_SIZE / 8);
             if (packedData.length !== expectedPackedSize) {
                 console.warn(`Decompressed size mismatch! Expected ${expectedPackedSize}, got ${packedData.length}.`);
             }
            gridData = unpackGridData(packedData);
            console.timeEnd("Decompression");

            infoDiv.textContent = `Loaded. URL Length: ${dataStr.length} chars`;
            console.log("Load successful.");
            return true;
        } catch (error) {
            console.error("Failed to decode/decompress data from URL hash:", error);
            gridData = [];
            infoDiv.textContent = "Error loading data!";
            return false;
        }
    }
    console.log("No data found in URL hash.");
    gridData = [];
    infoDiv.textContent = "Draw something!";
    return false;
}


// --- Event Listeners ---

window.addEventListener('resize', () => {
    setupCanvas();
});

// Control Listeners
brushSelectors.forEach(button => {
    button.addEventListener('click', () => {
        currentBrushKey = button.dataset.brush;
        updateBrushSelectionUI();
    });
});

colorSelectors.forEach(swatch => {
    swatch.addEventListener('click', () => {
        currentColorIndex = parseInt(swatch.dataset.colorIndex);
        updateColorSelectionUI();
    });
});


// Canvas Drawing Listeners
function getCanvasCoordinates(event) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const clientX = event.touches ? event.touches[0].clientX : event.clientX;
    const clientY = event.touches ? event.touches[0].clientY : event.clientY;
    const canvasX = (clientX - rect.left) * scaleX;
    const canvasY = (clientY - rect.top) * scaleY;
    const gridX = Math.floor(canvasX);
    const gridY = Math.floor(canvasY);
    return { gridX, gridY };
}

function handlePointerDown(event) {
    event.preventDefault();
    isDrawing = true;
    const { gridX, gridY } = getCanvasCoordinates(event);
    applyBrush(gridX, gridY); // Apply brush at the starting point
}

function handlePointerMove(event) {
    if (!isDrawing) return;
    event.preventDefault();
    const { gridX, gridY } = getCanvasCoordinates(event);
    applyBrush(gridX, gridY); // Apply brush continuously
}

function handlePointerUp(event) {
    if (!isDrawing) return;
    event.preventDefault();
    isDrawing = false;
    // Optional: Trigger immediate URL update check if needed, but debounce usually covers it
    // clearTimeout(updateUrlTimeout);
    // updateUrl();
}

function handlePointerLeave(event) {
    if (isDrawing) {
        isDrawing = false;
    }
}

canvas.addEventListener('pointerdown', handlePointerDown);
canvas.addEventListener('pointermove', handlePointerMove);
canvas.addEventListener('pointerup', handlePointerUp);
canvas.addEventListener('pointerleave', handlePointerLeave);
canvas.addEventListener('contextmenu', (e) => e.preventDefault());


// --- Initialization ---
if (typeof pako === 'undefined') {
     console.error("Pako library not loaded!");
     alert("Error: Compression library failed to load.");
     infoDiv.textContent = "Error: Compression library missing!";
} else {
    loadFromUrl(); // Load data first
    setupCanvas(); // Then setup canvas size and draw initial state
    // Set initial UI states
    updateBrushSelectionUI();
    updateColorSelectionUI();
}