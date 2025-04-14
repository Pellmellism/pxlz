// canvas-pan-util.js - Adds canvas CONTENT panning functionality

function initCanvasPanUtil() {
    const pixelApp = window.pixelEditorApp;
    console.log('%cInitializing Canvas CONTENT Pan Utility...', 'color: green; font-weight: bold;');

    // --- Check Dependencies ---
    if (typeof window.pixelEditorApp === 'undefined' ||
        typeof window.pixelEditorApp.getCanvas !== 'function' || // Keep this check even if not moving element
        typeof window.pixelEditorApp.getGridData !== 'function' ||
        typeof window.pixelEditorApp.updateCanvas !== 'function' ||
        typeof window.pixelEditorApp.getCanvasCoordinates !== 'function' ||
        typeof window.pixelEditorApp.getCurrentBrushKey !== 'function' ||
        typeof window.pixelEditorApp.setCurrentBrushKey !== 'function') {
        console.error('Canvas Pan Util ERROR: Required pixelEditorApp methods are missing.');
        console.log('Available keys in pixelEditorApp:', Object.keys(window.pixelEditorApp || {}));
        return;
    }
    const canvas = pixelApp.getCanvas();
    const controlsDiv = document.getElementById('controls'); // Need controls div reference

    // --- State Variables ---
    let isPanning = false;
    let panStartClientX = 0; // Keep client coords for cursor style etc.
    let panStartClientY = 0;
    let lastPanGridX = -1;   // Store the *last* grid position during a pan
    let lastPanGridY = -1;
    const SECONDARY_COLOR_INDEX = 1; // Assume 1 is always the secondary/fill color index

    // --- Create Pan Button (Ensure only one) ---
    const existingPanButton = controlsDiv.querySelector('#panButton');
    if (!existingPanButton) {
        const panButton = document.createElement('button');
        panButton.id = 'panButton'; // Give it an ID for easy checking
        panButton.className = 'brush-selector'; // Use same class for styling and selection logic
        panButton.dataset.brush = 'pan'; // Identify this button
        panButton.title = 'Pan Tool (Move Canvas Content)';
        // SVG Hand Icon
        panButton.innerHTML = `
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M18 11V6a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v0"></path>
                <path d="M14 10V4a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v2"></path>
                <path d="M10 10.5V6a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v8"></path>
                <path d="M18 8a2 2 0 0 0-2 2v8a2 2 0 0 1-2 2h-2a2 2 0 0 1-2-2v-4a2 2 0 0 0-2-2h-2a2 2 0 0 0-2 2v4a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2h-2"></path>
            </svg>`;

        // Insert the button into the first control group
        const firstControlGroup = controlsDiv.querySelector('.control-group');
        const largeBrushButton = controlsDiv.querySelector('[data-brush="large"]');
        if (firstControlGroup && largeBrushButton) {
            largeBrushButton.parentNode.insertBefore(panButton, largeBrushButton.nextSibling);
            console.log('Pan button added to controls.');

            // Add Click Listener to Pan Button
            panButton.addEventListener('click', () => {
                pixelApp.setCurrentBrushKey('pan');
                canvas.style.cursor = 'grab'; // Set initial cursor for pan tool
            });

        } else {
            console.error('Canvas Pan Util: Could not find insertion point for pan button.');
            // Don't return, maybe drawing still works
        }
    } else {
        console.log('Pan button already exists.');
    }


    // --- Core Panning Logic ---
    function shiftGridData(deltaX, deltaY) {
        if (deltaX === 0 && deltaY === 0) return false; // No change

        const GRID_SIZE = 256; // Assuming this is constant, maybe get from app later
        const oldGridData = pixelApp.getGridData(); // Get reference to the current grid
        const newGridData = Array(GRID_SIZE).fill(0).map(() => Array(GRID_SIZE).fill(SECONDARY_COLOR_INDEX)); // Initialize new grid with fill color

        console.log(`Shifting grid by dx=${deltaX}, dy=${deltaY}`);

        for (let destY = 0; destY < GRID_SIZE; destY++) {
            for (let destX = 0; destX < GRID_SIZE; destX++) {
                const sourceX = destX - deltaX;
                const sourceY = destY - deltaY;

                // Check if the source pixel is within the bounds of the old grid
                if (sourceX >= 0 && sourceX < GRID_SIZE && sourceY >= 0 && sourceY < GRID_SIZE) {
                    // Copy the pixel from the old grid
                    newGridData[destY][destX] = oldGridData[sourceY][sourceX];
                }
                // Else: it remains the SECONDARY_COLOR_INDEX (fill color)
            }
        }

        // IMPORTANT: Overwrite the original gridData array content.
        // We need to modify the array pixelApp holds the reference to.
        for (let y = 0; y < GRID_SIZE; y++) {
            // Method 1: Replace row by row (might be slightly slower but safer reference-wise)
             // oldGridData[y] = newGridData[y];
            // Method 2: Copy element by element (might be faster if Method 1 causes issues)
             for (let x = 0; x < GRID_SIZE; x++) {
                 oldGridData[y][x] = newGridData[y][x];
             }
        }
        // Do NOT do: oldGridData = newGridData; as this only changes the local variable.

        return true; // Indicate that data was changed
    }


    // --- Enhanced Event Handlers ---
    function panUtilDrawStart(event) {
        if (pixelApp.getCurrentBrushKey() === 'pan') {
            event.preventDefault(); // Prevent default touch actions like scrolling
            isPanning = true;
            const pos = getEventClientPos(event);
            panStartClientX = pos.x;
            panStartClientY = pos.y;
            const { gridX, gridY } = pixelApp.getCanvasCoordinates(event); // Get grid coords directly
            lastPanGridX = gridX;
            lastPanGridY = gridY;
            canvas.style.cursor = 'grabbing';
            console.log(`Panning started at grid (${gridX}, ${gridY})`);
        } else {
            canvas.style.cursor = 'crosshair'; // Ensure crosshair if drawing
            pixelApp.originalHandleDrawStart(event); // Call original drawing handler
        }
    }

    function panUtilDrawMove(event) {
        if (isPanning && pixelApp.getCurrentBrushKey() === 'pan') {
            event.preventDefault();
            const { gridX, gridY } = pixelApp.getCanvasCoordinates(event);

            const deltaX = gridX - lastPanGridX;
            const deltaY = gridY - lastPanGridY;

            if (deltaX !== 0 || deltaY !== 0) {
                 console.log(`Pan move: current grid (${gridX}, ${gridY}), delta (${deltaX}, ${deltaY})`);
                if (shiftGridData(deltaX, deltaY)) {
                    pixelApp.updateCanvas(); // Redraw the canvas with shifted data (triggers URL update implicitly)
                }
                // Update last grid position *after* calculating delta
                lastPanGridX = gridX;
                lastPanGridY = gridY;
            }
            // No need to update client coords here unless used for something else
        } else if (pixelApp.getCurrentBrushKey() !== 'pan' && pixelApp.originalHandleDrawMove) {
            // Call original only if drawing and the function exists
            pixelApp.originalHandleDrawMove(event);
        }
    }

    function panUtilDrawEnd(event) {
        if (isPanning && pixelApp.getCurrentBrushKey() === 'pan') {
            // No preventDefault needed here as it doesn't bubble like move/start often does
            isPanning = false;
            canvas.style.cursor = 'grab'; // Reset to grab cursor for pan tool
            console.log(`Panning ended.`);
            // Optionally trigger a final URL update if needed immediately
            // pixelApp.updateCanvas(); // Already called in move, rely on debounce or last move call
            lastPanGridX = -1; // Reset last position
            lastPanGridY = -1;
        } else if (pixelApp.getCurrentBrushKey() !== 'pan' && pixelApp.originalHandleDrawEnd) {
            canvas.style.cursor = 'crosshair';
            pixelApp.originalHandleDrawEnd(event);
        } else {
             // If pan tool is selected but we weren't actively panning (e.g., just clicked)
             canvas.style.cursor = 'grab';
        }
    }

     function panUtilDrawCancel(event) { // Renamed for clarity
        if (isPanning) { // If panning was active, reset state
             isPanning = false;
             canvas.style.cursor = 'grab'; // Reset cursor appropriate for pan tool
             console.log('Panning cancelled');
             lastPanGridX = -1;
             lastPanGridY = -1;
        }
         // Always call original cancel handler regardless of tool, if it exists
         if (pixelApp.originalHandleDrawCancel) {
             pixelApp.originalHandleDrawCancel(event);
         }
         // If not panning, ensure cursor matches current tool
         else if (pixelApp.getCurrentBrushKey() !== 'pan') {
              canvas.style.cursor = 'crosshair';
         }
    }


    // --- Helper Function (Unchanged) ---
    function getEventClientPos(e) {
        if (e.touches && e.touches.length > 0) {
            return { x: e.touches[0].clientX, y: e.touches[0].clientY };
        } else if (e.changedTouches && e.changedTouches.length > 0) {
            return { x: e.changedTouches[0].clientX, y: e.changedTouches[0].clientY };
        }
        return { x: e.clientX, y: e.clientY };
    }

    // --- Replace Original Listeners ---
    // Remove old listeners carefully, checking if the original functions exist
    if (pixelApp.originalHandleDrawStart) canvas.removeEventListener('touchstart', pixelApp.originalHandleDrawStart);
    if (pixelApp.originalHandleDrawMove) canvas.removeEventListener('touchmove', pixelApp.originalHandleDrawMove);
    if (pixelApp.originalHandleDrawEnd) canvas.removeEventListener('touchend', pixelApp.originalHandleDrawEnd);
    if (pixelApp.originalHandleDrawCancel) canvas.removeEventListener('touchcancel', pixelApp.originalHandleDrawCancel);
    if (pixelApp.originalHandleDrawStart) canvas.removeEventListener('mousedown', pixelApp.originalHandleDrawStart);
    if (pixelApp.originalHandleDrawMove) canvas.removeEventListener('mousemove', pixelApp.originalHandleDrawMove);
    if (pixelApp.originalHandleDrawEnd) canvas.removeEventListener('mouseup', pixelApp.originalHandleDrawEnd);
    // Keep mouseleave using the *cancel* logic for pan, *end* logic for draw? No, cancel is safer for both.
    // Let's map mouseleave to the combined cancel handler panUtilDrawCancel
    if (pixelApp.originalHandleDrawCancel) canvas.removeEventListener('mouseleave', pixelApp.originalHandleDrawCancel); // Remove old one if it existed
    else if (pixelApp.originalHandleDrawEnd) canvas.removeEventListener('mouseleave', pixelApp.originalHandleDrawEnd); // Might have been mapped to end previously

    // Add the new wrapped listeners
    canvas.addEventListener('touchstart', panUtilDrawStart, { passive: false });
    canvas.addEventListener('touchmove', panUtilDrawMove, { passive: false });
    canvas.addEventListener('touchend', panUtilDrawEnd, { passive: false }); // Use end logic
    canvas.addEventListener('touchcancel', panUtilDrawCancel); // Use cancel logic
    canvas.addEventListener('mousedown', panUtilDrawStart);
    canvas.addEventListener('mousemove', panUtilDrawMove);
    canvas.addEventListener('mouseup', panUtilDrawEnd); // Use end logic
    canvas.addEventListener('mouseleave', panUtilDrawCancel); // Use cancel logic for mouseleave too

    console.log('Canvas CONTENT Pan Utility initialized and event listeners replaced.');

    // Set initial cursor based on the *actual* current tool after potential loading
     if(pixelApp.getCurrentBrushKey() === 'pan') {
        canvas.style.cursor = 'grab';
    } else {
         canvas.style.cursor = 'crosshair';
    }
}


// --- Initialization Trigger ---
// Ensure this runs *after* script.js has initialized pixelEditorApp
if (document.readyState === 'loading') {
    // Use DOMContentLoaded as it fires earlier than load, but after parsing
    window.addEventListener('DOMContentLoaded', () => setTimeout(initCanvasPanUtil, 50)); // Delay slightly after DOM ready
} else {
    // DOM is already loaded, but ensure script.js might have run
    setTimeout(initCanvasPanUtil, 50); // Short delay
}