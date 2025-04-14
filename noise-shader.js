// noise-shader.js - Refined Screenshot Safe Mode (v4 - Consistent Motion)

function initNoiseShader() {
    console.log('Initializing Screenshot Safe Shader (v4 - Consistent Motion)...');

    // --- Dependencies ---
    if (typeof window.pixelEditorApp === 'undefined' ||
        typeof window.pixelEditorApp.getCanvas !== 'function' ||
        typeof window.pixelEditorApp.getGridData !== 'function' ||
        typeof window.pixelEditorApp.updateCanvas !== 'function') {
        console.error('Noise Shader ERROR: Required pixelEditorApp methods are missing.');
        return;
    }

    const canvas = window.pixelEditorApp.getCanvas();
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const screenshotSafeButton = document.getElementById('screenshotSafeButton');

    if (!screenshotSafeButton || !ctx) {
        console.error('Noise Shader ERROR: Button or 2D Context not found.');
        return;
    }

    // --- State Variables ---
    let isScreenshotSafeMode = false;
    let noiseAnimationId = null;
    // let frameCount = 0; // No longer needed for direction change
    const GRID_SIZE = 256;

    // Buffers for temporal coherence (flow)
    let noiseBufferA = new Float32Array(GRID_SIZE * GRID_SIZE); // Read buffer (previous frame's result)
    let noiseBufferB = new Float32Array(GRID_SIZE * GRID_SIZE); // Write buffer (current frame's calculation)

    // Separate buffer for random values
    let randomValues = new Float32Array(GRID_SIZE * GRID_SIZE);

    // --- Consistent Flow Direction ---
    const direction = { x: 1, y: 1 }; // Fixed diagonal flow

    // Initialize buffers
    fillNoiseBuffers();
    fillRandomValues();

    // --- Toggle Button ---
    screenshotSafeButton.addEventListener('click', () => {
        isScreenshotSafeMode = !isScreenshotSafeMode;
        screenshotSafeButton.classList.toggle('active', isScreenshotSafeMode);

        if (isScreenshotSafeMode) {
            console.log('Screenshot Safe Mode activated (Consistent Motion v4)');
            // Reset buffers for a fresh start
            fillNoiseBuffers();
            fillRandomValues();
            startNoiseShader();
        } else {
            console.log('Screenshot Safe Mode deactivated');
            stopNoiseShader();
            // Restore original canvas state
            window.pixelEditorApp.updateCanvas();
        }
    });

    // --- Buffer Initialization ---
    function fillNoiseBuffers() {
        for (let i = 0; i < noiseBufferA.length; i++) {
            noiseBufferA[i] = Math.random(); // Initialize with random values
            noiseBufferB[i] = 0;
        }
        console.log("Flow noise buffers initialized.");
    }

    function fillRandomValues() {
        for (let i = 0; i < randomValues.length; i++) {
            randomValues[i] = Math.random();
        }
        // No need to log every frame if generated frequently
        // console.log("Random value buffer initialized.");
    }

    // --- Helper: Fisher-Yates Shuffle ---
    function shuffleArray(array) {
        for (let i = array.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [array[i], array[j]] = [array[j], array[i]];
        }
    }

    // --- Helper Functions ---
    function getBufferIndex(x, y) {
        return y * GRID_SIZE + x;
    }

    function wrap(value, size) {
        return ((value % size) + size) % size;
    }

    // Calculates the SOURCE coordinate from which the current pixel (x,y) receives its flow value
    function getFlowSourceCoord(x, y) {
        return {
            x: wrap(x - direction.x, GRID_SIZE),
            y: wrap(y - direction.y, GRID_SIZE)
        };
    }

    // --- Shader Implementation ---
    function applyNoiseShader() {
        if (!isScreenshotSafeMode || !window.pixelEditorApp) return;

        const gridData = window.pixelEditorApp.getGridData();
        if (!gridData || !gridData.length) return;

        // --- Update Randomness ---
        // Shuffle the random values array EVERY frame for maximum disruption
        shuffleArray(randomValues);
        // Or regenerate every frame if shuffle looks too patterned:
        // fillRandomValues();

        let imageData;
        try {
            imageData = ctx.getImageData(0, 0, GRID_SIZE, GRID_SIZE);
        } catch (e) {
             console.error("Noise Shader: Failed to get ImageData", e);
             stopNoiseShader();
             return;
        }
        const data = imageData.data;

        // --- Process Pixels ---
        for (let y = 0; y < GRID_SIZE; y++) {
            for (let x = 0; x < GRID_SIZE; x++) {
                const currentIndex = getBufferIndex(x, y);
                const pixelDisplayIndex = currentIndex * 4;

                // Get original pixel value (0=black, 1=white)
                const originalPixelValue = (gridData[y] && gridData[y][x] !== undefined) ? gridData[y][x] : 1;

                // Determine the source coordinate for the flowing noise
                const flowSourceCoord = getFlowSourceCoord(x, y);
                const flowSourceIndex = getBufferIndex(flowSourceCoord.x, flowSourceCoord.y);

                let calculatedNoiseValue;

                // --- Conditional Logic ---
                if (originalPixelValue === 1) { // Bright Pixel (Original Image = White)
                    // Use the flowing noise value from the previous frame, read from the calculated source coordinate
                    calculatedNoiseValue = noiseBufferA[flowSourceIndex];
                } else { // Dark Pixel (Original Image = Black)
                    // Use a *new* random value for this pixel from the shuffled buffer
                    calculatedNoiseValue = randomValues[currentIndex];
                }

                // Clamp value to ensure it stays within 0.0 - 1.0 range
                calculatedNoiseValue = Math.max(0.0, Math.min(1.0, calculatedNoiseValue));

                // Write the calculated value to the *next* frame's buffer (B) at the *current* pixel's index.
                // This value becomes the input for the next frame's calculation at this (x,y).
                noiseBufferB[currentIndex] = calculatedNoiseValue;

                // --- Display Logic ---
                // Display the value we just calculated and stored in buffer B
                const displayGrayValue = Math.floor(calculatedNoiseValue * 255);
                data[pixelDisplayIndex] = displayGrayValue;     // R
                data[pixelDisplayIndex + 1] = displayGrayValue; // G
                data[pixelDisplayIndex + 2] = displayGrayValue; // B
                data[pixelDisplayIndex + 3] = 255;              // Alpha
            }
        }

        // Put the modified image data back onto the canvas
        ctx.putImageData(imageData, 0, 0);

        // Swap buffers for the next frame: The results just calculated (B) become the input (A)
        [noiseBufferA, noiseBufferB] = [noiseBufferB, noiseBufferA];
    }

    // --- Animation Control ---
    function startNoiseShader() {
        if (noiseAnimationId) cancelAnimationFrame(noiseAnimationId);
        console.log("Starting consistent motion noise shader (v4)...");
        function animateNoise() {
            applyNoiseShader();
            noiseAnimationId = requestAnimationFrame(animateNoise);
        }
        noiseAnimationId = requestAnimationFrame(animateNoise);
    }

    function stopNoiseShader() {
        if (noiseAnimationId) {
            cancelAnimationFrame(noiseAnimationId);
            noiseAnimationId = null;
            console.log("Stopped consistent motion noise shader.");
        }
        // Restore original view
        if (window.pixelEditorApp && typeof window.pixelEditorApp.updateCanvas === 'function') {
             console.log("Restoring original canvas view.");
             window.pixelEditorApp.updateCanvas();
        } else {
             console.warn("Could not restore original canvas view.");
        }
    }

    // --- Public API ---
    window.noiseShader = {
        isActive: () => isScreenshotSafeMode,
        toggle: () => {
            screenshotSafeButton.click();
        }
    };

    console.log('Screenshot Safe Shader (v4 - Consistent Motion) initialization complete.');
}

// --- Initialization Trigger ---
if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', () => setTimeout(initNoiseShader, 200));
} else {
    setTimeout(initNoiseShader, 200);
}