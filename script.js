// --- Configuration & Constants ---
const canvas = document.getElementById('pixelCanvas');
const ctx = canvas.getContext('2d');
const infoDiv = document.getElementById('info');
const controlsDiv = document.getElementById('controls');
const messageInput = document.getElementById('messageInput');
const clearButton = document.getElementById('clearButton');
const brushSelectors = controlsDiv.querySelectorAll('.brush-selector');
const colorSelectors = controlsDiv.querySelectorAll('.color-selector');
const colorPickers = document.querySelectorAll('.color-picker');

const GRID_SIZE = 256;
let COLOR1 = '#000000'; // Black
let COLOR2 = '#FFFFFF'; // White
let COLORS = [COLOR1, COLOR2]; // Index 0=Primary/FG, Index 1=Secondary/BG
const DEBOUNCE_DELAY = 1500;
const MSG_PARAM_SEPARATOR = '~'; // Use ~ to separate data from message

// --- Adaptive Encoding Constants ---
const TARGET_BASE64_BUDGET = 10500; // Max chars for the Base64 part (Image+Color)
const PREFIX_BITS = 2;
const PREFIX_RAW = 0;       // 00
const PREFIX_MONO = 1;      // 01
const PREFIX_MINORITY = 2;  // 10
// 11 is unused for now

const BITS_PER_COORD = 8; // X-coordinate only
const BITS_FOR_MINORITY_COUNT = 8; // Max minority count is 128, so 8 bits suffice
const MINORITY_THRESHOLD = 30; // Max minority pixels to use coordinate list encoding

const BITS_PER_COLOR_COMPONENT = 8;
const BITS_FOR_COLORS = 6 * BITS_PER_COLOR_COMPONENT; // 48 bits for #RRGGBB #RRGGBB

// Calculate Max Bits based on Base64 Budget (approximate)
// Max Bytes = floor(Budget * 3 / 4)
// Max Bits = Max Bytes * 8
const MAX_BYTES_BUDGET = Math.floor(TARGET_BASE64_BUDGET * 3 / 4);
const MAX_BITS_BUDGET = MAX_BYTES_BUDGET * 8;
console.log(`Target Base64 Budget: ${TARGET_BASE64_BUDGET} chars`);
console.log(`Calculated Max Bytes: ${MAX_BYTES_BUDGET}`);
console.log(`Calculated Max Bits (Colors + Rows): ${MAX_BITS_BUDGET}`);

// Brush definitions (unchanged)
const BRUSHES = {
    small: { size: 2, radiusSq: 1.1 },
    medium: { size: 5, radiusSq: 2.5 * 2.5 },
    large: { size: 9, radiusSq: 4.5 * 4.5 }
};

// --- State ---
let gridData = []; // 2D array GRID_SIZE x GRID_SIZE, stores 0 or 1
let currentBrushKey = 'small';
let currentColorIndex = 0; // Current drawing color index (0 or 1)
let canvasSize = 0;
let cellSize = 0;
let updateUrlTimeout;
let isDrawing = false;
let lastDrawPosition = { x: -1, y: -1 };

// --- Bit Buffer Class ---
class BitBuffer {
    constructor(initialBytes = null) {
        if (initialBytes) {
            this.buffer = new Uint8Array(initialBytes);
            this.byteLength = initialBytes.length;
            this.bitLength = this.byteLength * 8;
        } else {
            this.buffer = new Uint8Array(1024); // Start with 1KB buffer
            this.byteLength = 0;
            this.bitLength = 0;
        }
        this.readByteOffset = 0;
        this.readBitOffset = 0;
        this.writeByteOffset = 0;
        this.writeBitOffset = 0;
    }

    _ensureCapacity(neededBits) {
        const requiredBytes = Math.ceil((this.bitLength + neededBits) / 8);
        if (requiredBytes > this.buffer.length) {
            const newSize = Math.max(requiredBytes, this.buffer.length * 2); // Double capacity
            const newBuffer = new Uint8Array(newSize);
            newBuffer.set(this.buffer.slice(0, this.byteLength));
            this.buffer = newBuffer;
            // console.log(`Resized buffer to ${newSize} bytes`);
        }
    }

    appendBit(bit) {
        this._ensureCapacity(1);
        if (bit) {
            this.buffer[this.writeByteOffset] |= (1 << (7 - this.writeBitOffset));
        }
        this.writeBitOffset++;
        this.bitLength++;
        if (this.writeBitOffset === 8) {
            this.writeBitOffset = 0;
            this.writeByteOffset++;
        }
        this.byteLength = Math.ceil(this.bitLength / 8);
    }

    appendBits(value, numBits) {
        this._ensureCapacity(numBits);
        for (let i = numBits - 1; i >= 0; i--) {
            this.appendBit((value >> i) & 1);
        }
    }

    appendBytes(bytes) {
         // Optimize for byte-aligned appends if possible
        if (this.writeBitOffset === 0) {
            this._ensureCapacity(bytes.length * 8);
            this.buffer.set(bytes, this.writeByteOffset);
            const bitsAdded = bytes.length * 8;
            this.bitLength += bitsAdded;
            this.byteLength += bytes.length;
            this.writeByteOffset += bytes.length;
        } else {
            // Fallback to bit-by-bit append if not aligned
            for (let i = 0; i < bytes.length; i++) {
                this.appendBits(bytes[i], 8);
            }
        }
    }


    readBit() {
        if (this.readByteOffset * 8 + this.readBitOffset >= this.bitLength) {
            // console.warn("Attempted to read past end of buffer");
            return null; // Indicate end of data
        }
        const bit = (this.buffer[this.readByteOffset] >> (7 - this.readBitOffset)) & 1;
        this.readBitOffset++;
        if (this.readBitOffset === 8) {
            this.readBitOffset = 0;
            this.readByteOffset++;
        }
        return bit;
    }

    readBits(numBits) {
        let value = 0;
        for (let i = 0; i < numBits; i++) {
            const bit = this.readBit();
            if (bit === null) {
                // console.warn(`Buffer ended unexpectedly while reading ${numBits} bits`);
                return null; // Indicate end of data / error
            }
            value = (value << 1) | bit;
        }
        return value;
    }

    readBytes(numBytes) {
        if (this.readBitOffset !== 0) {
             console.warn("Reading bytes from non-aligned buffer position!");
             // Fallback to bit reading might be needed, but often indicates an issue.
             // For simplicity, we'll assume byte alignment or return null.
              return null;
        }
         const endOffset = this.readByteOffset + numBytes;
         if (endOffset > this.byteLength) {
              // console.warn("Attempted to read bytes past end of buffer");
              return null;
         }
         const result = this.buffer.slice(this.readByteOffset, endOffset);
         this.readByteOffset += numBytes;
         return result;
    }


    hasMoreBits(count = 1) {
         return (this.readByteOffset * 8 + this.readBitOffset) <= (this.bitLength - count);
    }

    getTotalBits() {
        return this.bitLength;
    }

    getByteArray() {
        // Return only the portion of the buffer that contains actual data
        return this.buffer.slice(0, this.byteLength);
    }
}


// --- Base64 & Bit Packing (Copied from previous version - unchanged) ---
const BASE64_URL_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

function uint8ArrayToBase64Url(bytes) { /* ... implementation unchanged ... */
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

function base64UrlToUint8Array(base64Url) { /* ... implementation unchanged ... */
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

// --- Color Conversion Helpers ---
function colorsToBytes(hexColor1, hexColor2) {
    const bytes = new Uint8Array(6);
    try {
        // Color 1
        bytes[0] = parseInt(hexColor1.substring(1, 3), 16);
        bytes[1] = parseInt(hexColor1.substring(3, 5), 16);
        bytes[2] = parseInt(hexColor1.substring(5, 7), 16);
        // Color 2
        bytes[3] = parseInt(hexColor2.substring(1, 3), 16);
        bytes[4] = parseInt(hexColor2.substring(3, 5), 16);
        bytes[5] = parseInt(hexColor2.substring(5, 7), 16);
    } catch (e) {
         console.error("Error converting colors to bytes:", e);
         // Return default black/white bytes on error
         return new Uint8Array([0, 0, 0, 255, 255, 255]);
    }
    return bytes;
}

function bytesToColors(byteArray6) {
    if (!byteArray6 || byteArray6.length < 6) {
        console.warn("Invalid byte array for color decoding, using defaults.");
        return ['#000000', '#FFFFFF']; // Return defaults
    }
    try {
        const hex = (byte) => byte.toString(16).padStart(2, '0');
        const color1 = `#${hex(byteArray6[0])}${hex(byteArray6[1])}${hex(byteArray6[2])}`;
        const color2 = `#${hex(byteArray6[3])}${hex(byteArray6[4])}${hex(byteArray6[5])}`;
        return [color1, color2];
    } catch(e) {
         console.error("Error converting bytes to colors:", e);
         return ['#000000', '#FFFFFF'];
    }
}

// --- Adaptive Encoding/Decoding ---

function encodeAdaptiveWithBudget(gridData, colors) {
    const bitBuffer = new BitBuffer();
    let budgetWarning = false;

    // 1. Append Colors First (always included)
    const colorBytes = colorsToBytes(colors[0], colors[1]);
    bitBuffer.appendBytes(colorBytes); // 48 bits

    let currentTotalBits = bitBuffer.getTotalBits();

    // 2. Encode Rows Adaptively within Budget
    for (let y = 0; y < GRID_SIZE; y++) {
        const row = gridData[y];
        let firstPixel = row[0];
        let isMono = true;
        let counts = [0, 0];
        let minorityCoords = [];

        // Analyze row
        counts[firstPixel]++;
        for (let x = 1; x < GRID_SIZE; x++) {
            counts[row[x]]++;
            if (row[x] !== firstPixel) {
                isMono = false;
            }
        }

        let method = PREFIX_RAW;
        let bitsForThisRow = PREFIX_BITS + 256; // Assume Raw initially
        let rowData = { prefix: PREFIX_RAW };

        if (isMono) {
            method = PREFIX_MONO;
            bitsForThisRow = PREFIX_BITS + 1;
            rowData = { prefix: PREFIX_MONO, color: firstPixel };
        } else {
            const minorityColor = counts[0] < counts[1] ? 0 : 1;
            const minorityCount = counts[minorityColor];

            if (minorityCount <= MINORITY_THRESHOLD) {
                 const bitsForMinority = PREFIX_BITS + 1 + BITS_FOR_MINORITY_COUNT + minorityCount * BITS_PER_COORD;
                 if (bitsForMinority < bitsForThisRow) { // Check if better than Raw
                     method = PREFIX_MINORITY;
                     bitsForThisRow = bitsForMinority;
                     // Collect coordinates only if using this method
                     for(let x=0; x<GRID_SIZE; x++) { if (row[x] === minorityColor) minorityCoords.push(x); }
                     rowData = {
                          prefix: PREFIX_MINORITY,
                          minorityColor: minorityColor,
                          count: minorityCount,
                          coords: minorityCoords
                     };
                 }
            }
            // If not mono and minority doesn't save bits, method remains PREFIX_RAW
        }

        // Budget Check
        if (currentTotalBits + bitsForThisRow > MAX_BITS_BUDGET) {
            console.warn(`Budget exceeded at row ${y}. Stopping encoding. Total bits so far: ${currentTotalBits}`);
            budgetWarning = true;
            break; // Stop encoding rows
        }

        // Append data for the chosen method
        bitBuffer.appendBits(rowData.prefix, PREFIX_BITS);
        currentTotalBits += PREFIX_BITS;

        if (rowData.prefix === PREFIX_MONO) {
            bitBuffer.appendBit(rowData.color);
            currentTotalBits += 1;
        } else if (rowData.prefix === PREFIX_MINORITY) {
            bitBuffer.appendBit(rowData.minorityColor);
            bitBuffer.appendBits(rowData.count, BITS_FOR_MINORITY_COUNT);
            for (const xCoord of rowData.coords) {
                bitBuffer.appendBits(xCoord, BITS_PER_COORD);
            }
            currentTotalBits += (1 + BITS_FOR_MINORITY_COUNT + rowData.count * BITS_PER_COORD);
        } else { // PREFIX_RAW
            // Append raw 256 bits for the row
            for (let x = 0; x < GRID_SIZE; x++) {
                bitBuffer.appendBit(row[x]);
            }
            currentTotalBits += 256;
        }
        // Sanity check (optional): if (currentTotalBits !== bitBuffer.getTotalBits()) console.error("Bit count mismatch!");

    } // End row loop

    if (budgetWarning) {
         infoDiv.textContent += ' (Warning: Data truncated)';
    }

    return bitBuffer.getByteArray();
}

function decodeAdaptiveWithBudget(encodedBytes) {
    const bitBuffer = new BitBuffer(encodedBytes);
    const secondaryColor = 1; // Assume default fill is White (index 1)

    // Create grid filled with secondary color (handles truncation)
    const newGridData = Array(GRID_SIZE).fill(0).map(() => Array(GRID_SIZE).fill(secondaryColor));

    // 1. Decode Colors
    if (!bitBuffer.hasMoreBits(BITS_FOR_COLORS)) {
         console.error("Not enough data for colors. Using defaults.");
         // Grid is already filled with secondary, primary needed for drawing? Use default.
         COLOR1 = '#000000'; COLOR2 = '#FFFFFF'; COLORS = [COLOR1, COLOR2];
         return newGridData; // Can't proceed without colors reliable
    }
    const colorBytes = new Uint8Array(6);
    for(let i=0; i<6; i++){
        const byte = bitBuffer.readBits(8);
        if (byte === null) throw new Error("Failed to read color byte");
        colorBytes[i] = byte;
    }
    const decodedColors = bytesToColors(colorBytes);
    COLOR1 = decodedColors[0];
    COLOR2 = decodedColors[1];
    COLORS = [COLOR1, COLOR2]; // Update global colors used for drawing

    // Now fill grid with *actual* secondary color from decoded data
     const actualSecondaryColorIndex = 1; // Usually white
     for (let y = 0; y < GRID_SIZE; y++) {
         for (let x = 0; x < GRID_SIZE; x++) {
              newGridData[y][x] = actualSecondaryColorIndex;
         }
     }

    // 2. Decode Rows
    for (let y = 0; y < GRID_SIZE; y++) {
        if (!bitBuffer.hasMoreBits(PREFIX_BITS)) {
            console.log(`Data ended before decoding row ${y}. Remaining rows filled with secondary color.`);
            break; // No more data
        }

        const prefix = bitBuffer.readBits(PREFIX_BITS);
        if (prefix === null) { console.warn(`Could not read prefix for row ${y}`); break; }

        try { // Add try-catch around row decoding
            if (prefix === PREFIX_MONO) {
                if (!bitBuffer.hasMoreBits(1)) { console.warn(`Data ended mid-mono row ${y}`); break; }
                const color = bitBuffer.readBit();
                 if (color === null) { console.warn(`Could not read color bit for row ${y}`); break; }
                for (let x = 0; x < GRID_SIZE; x++) {
                    newGridData[y][x] = color;
                }
            } else if (prefix === PREFIX_MINORITY) {
                if (!bitBuffer.hasMoreBits(1 + BITS_FOR_MINORITY_COUNT)) { console.warn(`Data ended mid-minority header row ${y}`); break; }
                const minorityColor = bitBuffer.readBit();
                const count = bitBuffer.readBits(BITS_FOR_MINORITY_COUNT);

                if (minorityColor === null || count === null || count > 128) { console.warn(`Invalid minority header for row ${y}`); break; } // Invalid count

                const majorityColor = 1 - minorityColor;
                // Fill with majority first (redundant due to initial fill, but safe)
                 // for (let x = 0; x < GRID_SIZE; x++) newGridData[y][x] = majorityColor;

                if (!bitBuffer.hasMoreBits(count * BITS_PER_COORD)) { console.warn(`Data ended mid-minority coords row ${y}`); break; }
                for (let i = 0; i < count; i++) {
                    const xCoord = bitBuffer.readBits(BITS_PER_COORD);
                    if (xCoord === null) { console.warn(`Could not read coord ${i} for row ${y}`); throw new Error("Coord read failed"); } // Throw to break outer loop
                    if (xCoord >= 0 && xCoord < GRID_SIZE) {
                         newGridData[y][xCoord] = minorityColor;
                    } else {
                         console.warn(`Invalid X-coordinate ${xCoord} decoded for row ${y}`);
                    }
                }
            } else if (prefix === PREFIX_RAW) {
                if (!bitBuffer.hasMoreBits(256)) { console.warn(`Data ended mid-raw row ${y}`); break; }
                for (let x = 0; x < GRID_SIZE; x++) {
                    const bit = bitBuffer.readBit();
                     if (bit === null) { console.warn(`Could not read raw bit ${x} for row ${y}`); throw new Error("Raw bit read failed"); }
                    newGridData[y][x] = bit;
                }
            } else {
                console.warn(`Unknown prefix ${prefix} encountered for row ${y}. Stopping decode.`);
                break; // Unknown prefix, stop decoding
            }
         } catch (e) {
             console.error(`Error decoding row ${y}:`, e.message);
             // Stop decoding process if read error occurred within a row
             break;
         }

    } // End row loop

    return newGridData;
}


// --- UI Update Functions (Mostly unchanged) ---
function updateBrushSelectionUI() { /* ... implementation unchanged ... */
    brushSelectors.forEach(btn => {
        if (btn.dataset.brush === currentBrushKey) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
        // Special handling for pan button potentially
        if (currentBrushKey === 'pan' && btn.dataset.brush === 'pan') {
             btn.classList.add('active');
        } else if (currentBrushKey !== 'pan' && btn.dataset.brush === 'pan'){
             btn.classList.remove('active');
        }
    });
}

function updateColorSelectionUI() { /* ... implementation unchanged ... */
    colorSelectors.forEach(swatch => {
        const index = parseInt(swatch.dataset.colorIndex);
        swatch.style.backgroundColor = COLORS[index];
        if (index === currentColorIndex) {
            swatch.classList.add('active');
        } else {
            swatch.classList.remove('active');
        }
    });
    colorPickers.forEach(picker => {
        const index = parseInt(picker.dataset.colorIndex);
        picker.value = COLORS[index];
    });
}

function updateColors(colorIndex, newColor) { /* ... implementation unchanged ... */
    if (colorIndex === 0) {
        COLOR1 = newColor;
    } else if (colorIndex === 1) {
        COLOR2 = newColor;
    }
    COLORS = [COLOR1, COLOR2];
    updateColorSelectionUI();
    redrawCanvas(); // Redraw needed if colors change
    scheduleUrlUpdate();
}

// --- Canvas Drawing (Mostly unchanged) ---
function setupCanvas() { /* ... implementation unchanged ... */
    const controlsHeight = controlsDiv.offsetHeight + 20;
    const messageHeight = document.querySelector('.message-container').offsetHeight + 10;
    const infoHeight = infoDiv.offsetHeight;
    const totalUIHeight = controlsHeight + messageHeight + infoHeight;
    const isLandscape = window.innerWidth > window.innerHeight;
    let canvasSize;
    if (isLandscape) {
        const availableHeight = window.innerHeight - totalUIHeight;
        canvasSize = Math.min(availableHeight * 0.95, window.innerWidth * 0.8);
    } else {
        const availableHeight = window.innerHeight - totalUIHeight;
        canvasSize = Math.min(window.innerWidth * 0.95, availableHeight * 0.8);
    }
    cellSize = Math.max(1, Math.floor(canvasSize / GRID_SIZE));
    canvasSize = cellSize * GRID_SIZE;
    canvas.width = GRID_SIZE;
    canvas.height = GRID_SIZE;
    canvas.style.width = `${canvasSize}px`;
    canvas.style.height = `${canvasSize}px`;
    ctx.imageSmoothingEnabled = false;
    if (gridData.length === 0) {
        console.log("Initializing empty grid (all secondary color).");
        gridData = Array(GRID_SIZE).fill(0).map(() => Array(GRID_SIZE).fill(1)); // Fill with secondary (white)
    }
    redrawCanvas();
}

function redrawCanvas() {
    // Use secondary color for background fill by default
    const bgColorIndex = 1;
    const fgColorIndex = 0;
    ctx.fillStyle = COLORS[bgColorIndex];
    ctx.fillRect(0, 0, GRID_SIZE, GRID_SIZE);
    ctx.fillStyle = COLORS[fgColorIndex];
    let drawCount = 0;
    for (let y = 0; y < GRID_SIZE; y++) {
        for (let x = 0; x < GRID_SIZE; x++) {
            // Draw only pixels that are NOT the background color
            if (gridData[y] && gridData[y][x] === fgColorIndex) {
                ctx.fillRect(x, y, 1, 1);
                drawCount++;
            }
             // Handle potential undefined gridData[y] during initialization or errors
             else if (gridData[y] && gridData[y][x] !== bgColorIndex && gridData[y][x] !== fgColorIndex) {
                  console.warn(`Unexpected value in gridData[${y}][${x}]: ${gridData[y][x]}. Drawing as FG.`);
                   ctx.fillRect(x, y, 1, 1); // Draw unexpected values as FG for visibility
             }
        }
    }
    
    // Apply noise shader if it's active
    if (window.noiseShader && window.noiseShader.isActive && window.noiseShader.isActive()) {
        // The actual noise rendering is handled by the animation loop in noise-shader.js
        // This just ensures we don't interfere with it
    }
    
    // console.log(`Canvas redrawn. Drew ${drawCount} foreground pixels.`);
}

function applyBrush(gridX, gridY) { /* ... implementation unchanged ... */
    if (currentBrushKey === 'pan') return; // Don't draw if panning tool active

    const brush = BRUSHES[currentBrushKey];
    if (!brush) { console.error(`Invalid brush key: ${currentBrushKey}`); return; }

    const size = brush.size;
    const radiusSq = brush.radiusSq;
    const drawColor = currentColorIndex;
    const halfSizeFloor = Math.floor(size / 2);
    const startX = gridX - halfSizeFloor;
    const startY = gridY - halfSizeFloor;
    const endX = startX + size;
    const endY = startY + size;
    let dataChanged = false;

    ctx.fillStyle = COLORS[drawColor];

    for (let py = startY; py < endY; py++) {
        for (let px = startX; px < endX; px++) {
            if (px >= 0 && px < GRID_SIZE && py >= 0 && py < GRID_SIZE) {
                let shouldDraw = true;
                if (size > 2) {
                    const distX = px - gridX;
                    const distY = py - gridY;
                    const distSq = distX * distX + distY * distY;
                    if (distSq > radiusSq) {
                         shouldDraw = false;
                    }
                }
                if (shouldDraw && gridData[py][px] !== drawColor) {
                    gridData[py][px] = drawColor;
                    ctx.fillRect(px, py, 1, 1);
                    dataChanged = true;
                }
            }
        }
    }
    if (dataChanged) {
        scheduleUrlUpdate();
    }
}

// --- URL Handling (NEW - Adaptive Encoding) ---

function scheduleUrlUpdate() {
    clearTimeout(updateUrlTimeout);
    updateUrlTimeout = setTimeout(updateUrl, DEBOUNCE_DELAY);
}

function updateUrl() {
    try {
        console.time("Adaptive Encoding");
        const encodedBytes = encodeAdaptiveWithBudget(gridData, COLORS);
        console.timeEnd("Adaptive Encoding");

        console.time("Base64 Encoding");
        const encodedData = uint8ArrayToBase64Url(encodedBytes);
        console.timeEnd("Base64 Encoding");

        const message = messageInput.value.trim();
        const encodedMessage = message ? encodeURIComponent(message) : '';

        // New structure: #<Base64_ColorsAndRows>[~<EncodedMessage>]
        let urlHash = `#${encodedData}`;
        if (encodedMessage) {
            urlHash += MSG_PARAM_SEPARATOR + encodedMessage;
        }

         // Check against theoretical budget (informational)
        if (encodedData.length > TARGET_BASE64_BUDGET) {
            console.warn(`Generated Base64 length (${encodedData.length}) exceeds target budget (${TARGET_BASE64_BUDGET}). Truncation should have occurred.`);
            infoDiv.textContent = `URL: ${encodedData.length} chars (Exceeded Budget!)`;
        } else {
             infoDiv.textContent = `URL: ${encodedData.length} / ${TARGET_BASE64_BUDGET} chars`;
        }

        window.location.hash = urlHash;
        // console.log("URL Updated. Base64 Length:", encodedData.length);

    } catch (error) {
        console.error("Error during URL update:", error);
        infoDiv.textContent = "Error generating URL!";
    }
}

function loadFromUrl() {
    const hashContent = window.location.hash;
    let dataStr = '';
    let messageStr = '';
    let loadedData = false;

    if (hashContent && hashContent.startsWith('#')) {
        const parts = hashContent.substring(1).split(MSG_PARAM_SEPARATOR, 2);
        dataStr = parts[0]; // Part 0: Combined Colors and Rows Data (Base64Url)
        if (parts.length > 1) {
            messageStr = parts[1]; // Part 1: Message (Encoded)
        }

        // Set message input value first
        try {
             messageInput.value = messageStr ? decodeURIComponent(messageStr) : '';
        } catch (e) { console.error("Error decoding message:", e); messageInput.value = ''; }
    }

    if (dataStr) {
        console.log("Loading adaptive data from URL hash...");
        infoDiv.textContent = `Loading (${dataStr.length} chars)...`;
        try {
            console.time("Base64 Decoding");
            const decodedBytes = base64UrlToUint8Array(dataStr);
            console.timeEnd("Base64 Decoding");

            console.time("Adaptive Decoding");
            gridData = decodeAdaptiveWithBudget(decodedBytes);
            console.timeEnd("Adaptive Decoding");

            infoDiv.textContent = `Loaded. URL Length: ${dataStr.length} chars`;
            console.log("Load successful.");
            loadedData = true;

        } catch (error) {
            console.error("Failed to decode/unpack adaptive data from URL hash:", error);
            gridData = []; // Clear grid on error
            infoDiv.textContent = "Error loading data!";
            loadedData = false;
        }
    } else {
         // No data string found
         loadedData = false;
    }

    if (!loadedData) {
        console.log("No valid data found in URL hash or load failed.");
        // Ensure grid is cleared and default colors applied if nothing loaded
        gridData = Array(GRID_SIZE).fill(0).map(() => Array(GRID_SIZE).fill(1)); // Default secondary
        COLOR1 = '#000000'; COLOR2 = '#FFFFFF'; COLORS = [COLOR1, COLOR2];
        infoDiv.textContent = "Draw something!";
    }

    // Update UI regardless of load success
    updateColorSelectionUI(); // Set colors from loaded data or defaults
    redrawCanvas(); // Draw the loaded grid or the default empty one

    return loadedData;
}


// --- Event Listeners (Mostly unchanged) ---

window.addEventListener('resize', setupCanvas);

// Control Listeners
brushSelectors.forEach(button => {
    button.addEventListener('click', () => {
        // Pan tool selection is handled by canvas-pan-util.js now
        if (button.dataset.brush !== 'pan') {
            currentBrushKey = button.dataset.brush;
            updateBrushSelectionUI();
             canvas.style.cursor = 'crosshair'; // Ensure crosshair for drawing tools
        }
         // If the pan button itself is clicked, let pan-util handle the state change
         // but update the UI here. If another brush is clicked, pan-util should
         // be informed or react passively. This needs coordination with pan-util.
         // For now, just update UI based on currentBrushKey.
         updateBrushSelectionUI();
    });
});

colorSelectors.forEach(swatch => { /* ... implementation unchanged ... */
    swatch.addEventListener('click', () => {
        currentColorIndex = parseInt(swatch.dataset.colorIndex);
        updateColorSelectionUI();
    });
});
colorPickers.forEach(picker => { /* ... implementation unchanged ... */
    picker.addEventListener('input', () => { /* ... */ updateColors(parseInt(picker.dataset.colorIndex), picker.value); });
    picker.addEventListener('change', () => { /* ... */ updateColors(parseInt(picker.dataset.colorIndex), picker.value); });
});
clearButton.addEventListener('click', () => { /* ... implementation unchanged ... */
    if (confirm('Are you sure you want to clear the canvas?')) { clearCanvas(); }
});
messageInput.addEventListener('input', scheduleUrlUpdate);

function clearCanvas() { /* ... implementation unchanged ... */
    gridData = Array(GRID_SIZE).fill(0).map(() => Array(GRID_SIZE).fill(1)); // Fill with secondary color
    redrawCanvas();
    scheduleUrlUpdate(); // Save cleared state
}

// Canvas Drawing Listeners
function getCanvasCoordinates(event) { /* ... implementation unchanged ... */
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    let clientX, clientY;
    if (event.touches && event.touches.length > 0) {
        clientX = event.touches[0].clientX; clientY = event.touches[0].clientY;
    } else if (event.changedTouches && event.changedTouches.length > 0) { // For touchend
         clientX = event.changedTouches[0].clientX; clientY = event.changedTouches[0].clientY;
    } else {
        clientX = event.clientX; clientY = event.clientY;
    }
    const canvasX = Math.max(0, Math.min(canvas.width - 1, (clientX - rect.left) * scaleX));
    const canvasY = Math.max(0, Math.min(canvas.height - 1, (clientY - rect.top) * scaleY));
    const gridX = Math.floor(canvasX);
    const gridY = Math.floor(canvasY);
    return { gridX, gridY };
}

function interpolateLine(x0, y0, x1, y1) { /* ... implementation unchanged ... */
    const points = []; const dx = Math.abs(x1 - x0); const dy = Math.abs(y1 - y0);
    const sx = (x0 < x1) ? 1 : -1; const sy = (y0 < y1) ? 1 : -1; let err = dx - dy;
    while (true) { points.push({ x: x0, y: y0 }); if (x0 === x1 && y0 === y1) break;
        const e2 = 2 * err; if (e2 > -dy) { if (x0 === x1) break; err -= dy; x0 += sx; }
        if (e2 < dx) { if (y0 === y1) break; err += dx; y0 += sy; } } return points;
}

function handleDrawStart(event) { /* ... implementation unchanged ... */
    // This will be overridden by pan-util if active.
    if (currentBrushKey === 'pan') return;
    event.preventDefault();
    isDrawing = true;
    const { gridX, gridY } = getCanvasCoordinates(event);
    applyBrush(gridX, gridY);
    lastDrawPosition = { x: gridX, y: gridY };
}

function handleDrawMove(event) { /* ... implementation unchanged ... */
    // This will be overridden by pan-util if active.
    if (!isDrawing || currentBrushKey === 'pan') return;
    event.preventDefault();
    const { gridX, gridY } = getCanvasCoordinates(event);
    if ((gridX !== lastDrawPosition.x || gridY !== lastDrawPosition.y) && lastDrawPosition.x >= 0) {
        const points = interpolateLine(lastDrawPosition.x, lastDrawPosition.y, gridX, gridY);
        for (const point of points) applyBrush(point.x, point.y);
    } else if (lastDrawPosition.x < 0) { // Handle first move if start was missed
         applyBrush(gridX, gridY);
    }
    lastDrawPosition = { x: gridX, y: gridY };
}

function handleDrawEnd(event) { /* ... implementation unchanged ... */
     // This will be overridden by pan-util if active.
    if (!isDrawing || currentBrushKey === 'pan') return;
    // Use changedTouches for touchend coordinates
    const coords = getCanvasCoordinates(event);
    // Apply brush at final point, interpolating if needed (though less critical on end)
    if ((coords.gridX !== lastDrawPosition.x || coords.gridY !== lastDrawPosition.y) && lastDrawPosition.x >= 0) {
       const points = interpolateLine(lastDrawPosition.x, lastDrawPosition.y, coords.gridX, coords.gridY);
       for (const point of points) applyBrush(point.x, point.y);
    } else if(lastDrawPosition.x < 0) { // If only a tap occurred
        applyBrush(coords.gridX, coords.gridY);
    }
    isDrawing = false;
    lastDrawPosition = { x: -1, y: -1 };
    clearTimeout(updateUrlTimeout); // Cancel any pending debounce
    updateUrl(); // Trigger immediate save on draw end
}

function handleDrawCancel(event) { /* ... implementation unchanged ... */
    // This will be overridden by pan-util if active.
    if (isDrawing) { // Only reset if drawing was in progress
         isDrawing = false;
         lastDrawPosition = { x: -1, y: -1 };
         console.log("Drawing cancelled.");
         // Maybe trigger save here too? Or rely on last successful move/end? Let's skip save on cancel.
    }
}

// --- Initialization ---
// Remove Pako check

loadFromUrl(); // Load data first (handles colors, grid, message)
setupCanvas(); // Setup canvas size based on viewport AFTER potential load
// Set initial UI states AFTER load and setup
updateBrushSelectionUI();
// updateColorSelectionUI(); // Called within loadFromUrl or uses defaults

// --- Expose to Utilities & Canvas Pan ---
window.pixelEditorApp = {
    getGridData: () => gridData,
    updateCanvas: () => { // Expose a way to trigger redraw and URL update
        redrawCanvas();
        scheduleUrlUpdate(); // Use debounce for external updates unless immediate needed
    },
    getCanvas: () => canvas,
    getCurrentBrushKey: () => currentBrushKey,
    setCurrentBrushKey: (key) => {
        if (key !== currentBrushKey) {
            currentBrushKey = key;
            updateBrushSelectionUI();
             // Update cursor based on tool
             if (key === 'pan') {
                 canvas.style.cursor = 'grab';
             } else {
                 canvas.style.cursor = 'crosshair';
             }
             console.log('Brush/Tool set to:', key);
        }
    },
    updateBrushSelectionUI: updateBrushSelectionUI, // Allow external update
    // Expose original handlers for wrapping
    originalHandleDrawStart: handleDrawStart,
    originalHandleDrawMove: handleDrawMove,
    originalHandleDrawEnd: handleDrawEnd,
    originalHandleDrawCancel: handleDrawCancel,
    getCanvasCoordinates: getCanvasCoordinates
};

// --- Initial Cursor Setup ---
// Set initial cursor based on the default brush
if (window.pixelEditorApp.getCurrentBrushKey() === 'pan') {
    canvas.style.cursor = 'grab';
} else {
    canvas.style.cursor = 'crosshair';
}

console.log("Pixel Editor (Adaptive Encoding with Budget) Initialized.");