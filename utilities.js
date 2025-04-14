// utilities.js - Additional utility features for pixel editor (v3 - Fixed Panning & Marching Ants)

function initUtilities() {
    console.log('Attempting to initialize utilities v3...');

    // --- Check for main app dependency ---
    if (typeof window.pixelEditorApp === 'undefined' ||
        typeof window.pixelEditorApp.getGridData !== 'function' ||
        typeof window.pixelEditorApp.updateCanvas !== 'function') {
        console.error('Pixel Editor App (window.pixelEditorApp) is not ready. Utilities cannot initialize.');
        return; // Stop initialization
    }
    console.log('Pixel Editor App found. Proceeding with utility initialization.');

    // --- State Variables ---
    let settingsMenu = null;
    let settingsIcon = null;
    let imageProcessingModal = null;
    let fileInput = null;
    let originalImage = null; // The user's loaded image
    let previewCanvas = null;
    let previewCtx = null;
    let previewWrapper = null;
    let thresholdSlider = null;
    let thresholdValueDisplay = null;
    let inversionCheckbox = null;
    let zoomInBtn = null;
    let zoomOutBtn = null;
    let zoomValueDisplay = null;
    let confirmBtn = null;
    let cancelBtn = null;
    let modalCloseBtn = null;

    let zoomLevel = 1.0;
    // NEW: sourceOffset represents the center of the view relative to the original image center (in original image pixels)
    let sourceOffset = { x: 0, y: 0 };
    let isDragging = false;
    let dragStart = { x: 0, y: 0 }; // Client coordinates of drag start
    let dragStartSourceOffset = { x: 0, y: 0 }; // Source offset at drag start
    const PREVIEW_CONTAINER_SIZE = 300; // Fixed size for the preview viewport

    // --- UI Creation Functions --- (Mostly unchanged, minor style tweaks might be needed)

    function createStyles() {
        const styleId = 'utilities-styles';
        if (document.getElementById(styleId)) return;

        const style = document.createElement('style');
        style.id = styleId;
        style.textContent = `
            /* --- Settings Icon/Menu --- */
            #settingsIcon {
                position: fixed; bottom: 15px; right: 15px; width: 40px; height: 40px;
                background-color: rgba(68, 68, 68, 0.9); border-radius: 50%;
                display: flex; align-items: center; justify-content: center;
                cursor: pointer; z-index: 1000; color: #eee;
                transition: background-color 0.2s ease;
                box-shadow: 0 2px 5px rgba(0, 0, 0, 0.3); padding: 8px; box-sizing: border-box;
            }
            #settingsIcon:hover { background-color: rgba(85, 85, 85, 0.9); }
            #settingsIcon svg { width: 24px; height: 24px; }

            #settingsMenu {
                position: fixed; bottom: 65px; right: 15px;
                background-color: #444; border-radius: 5px; padding: 10px;
                box-shadow: 0 3px 10px rgba(0, 0, 0, 0.3); z-index: 999;
                display: none; flex-direction: column; min-width: 180px;
            }
            #settingsMenu.visible { display: flex; }

            .menu-item {
                padding: 8px 12px; cursor: pointer; border-radius: 3px; color: #eee;
                margin-bottom: 5px; display: flex; align-items: center; transition: background-color 0.2s;
            }
            .menu-item:hover { background-color: #555; }
            .menu-item:last-child { margin-bottom: 0; }
            .menu-item svg { margin-right: 8px; width: 18px; height: 18px; }

            /* --- Modal Styling --- */
            .modal {
                position: fixed; top: 0; left: 0; width: 100%; height: 100%;
                background-color: rgba(0, 0, 0, 0.7); display: none;
                align-items: center; justify-content: center; z-index: 2000;
                opacity: 0; transition: opacity 0.3s ease-out;
            }
            .modal.visible { display: flex; opacity: 1; }

            .modal-content {
                background-color: #333; border-radius: 5px; padding: 20px;
                width: 90%; max-width: 500px; box-shadow: 0 3px 15px rgba(0, 0, 0, 0.5);
                position: relative; color: #eee;
            }
            .modal-close {
                position: absolute; top: 10px; right: 10px; font-size: 24px; line-height: 1;
                cursor: pointer; color: #aaa; font-weight: bold;
            }
            .modal-close:hover { color: #eee; }

            /* --- Image Processing Specific Styles --- */
            .preview-container { margin: 15px 0; text-align: center; }
            .preview-wrapper {
                width: ${PREVIEW_CONTAINER_SIZE}px; height: ${PREVIEW_CONTAINER_SIZE}px;
                overflow: hidden; /* Crucial: hides parts of canvas outside wrapper */
                position: relative; /* Needed for absolute positioning of canvas */
                border: 1px solid #666;
                cursor: move; background-color: #222; margin: 0 auto;
            }
            #imagePreviewCanvas {
                position: absolute; /* Will be positioned by JS */
                top: 0; left: 0; /* Initial position, will be adjusted */
                /* Crisp edges for preview */
                image-rendering: pixelated; image-rendering: crisp-edges;
            }
            .preview-controls { display: flex; justify-content: center; margin-top: 10px; gap: 10px; }
            .zoom-button {
                padding: 5px 10px; background-color: #444; border: 1px solid #555;
                border-radius: 3px; color: #eee; cursor: pointer; font-size: 16px;
                width: 35px; text-align: center;
            }
            .zoom-button:hover { background-color: #555; }
            .zoom-value { display: flex; align-items: center; font-size: 14px; width: 50px; justify-content: center;}
            .preview-instructions { font-size: 12px; color: #aaa; margin-top: 8px; }

            .processing-options { margin: 15px 0; }
            .processing-options label { display: block; margin-bottom: 8px; font-size: 14px; }
            .processing-options input[type=range] { width: 100%; margin-top: 5px; }
            .processing-options input[type=checkbox] { margin-right: 5px; vertical-align: middle; }

            .button-group { display: flex; justify-content: flex-end; gap: 10px; margin-top: 20px; }
            .button { padding: 8px 15px; border: none; border-radius: 3px; cursor: pointer; font-size: 14px; }
            .button-primary { background-color: #5a5; color: #fff; }
            .button-primary:hover { background-color: #6b6; }
            .button-secondary { background-color: #555; color: #ddd; }
            .button-secondary:hover { background-color: #666; }

            #hiddenFileInput { display: none; }
        `;
        document.head.appendChild(style);
    }

    function createSettingsIconAndMenu() {
        // --- Settings Icon --- (Code identical to v2)
        settingsIcon = document.createElement('div');
        settingsIcon.id = 'settingsIcon';
        settingsIcon.title = 'Settings & Utilities';
        settingsIcon.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>`;
        document.body.appendChild(settingsIcon);

        // --- Settings Menu --- (Code identical to v2)
        settingsMenu = document.createElement('div');
        settingsMenu.id = 'settingsMenu';
        document.body.appendChild(settingsMenu);

        // --- File Input --- (Code identical to v2)
        fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.id = 'hiddenFileInput';
        fileInput.accept = 'image/png, image/jpeg, image/gif, image/bmp';
        document.body.appendChild(fileInput);

        // --- Menu Item: Load Image --- (Code identical to v2)
        const loadImageItem = document.createElement('div');
        loadImageItem.className = 'menu-item';
        loadImageItem.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>Load Image`;
        settingsMenu.appendChild(loadImageItem);

        // --- Event Listeners --- (Code identical to v2)
        settingsIcon.addEventListener('click', (e) => {
            e.stopPropagation();
            settingsMenu.classList.toggle('visible');
        });

        loadImageItem.addEventListener('click', () => {
            fileInput.click();
            settingsMenu.classList.remove('visible');
        });

        fileInput.addEventListener('change', handleFileSelect);

        document.addEventListener('click', (e) => {
            if (settingsMenu.classList.contains('visible') &&
                !settingsMenu.contains(e.target) &&
                e.target !== settingsIcon && !settingsIcon.contains(e.target)) {
                settingsMenu.classList.remove('visible');
            }
        });
    }

    function createImageProcessingModal() {
         // --- Code identical to v2 ---
        if (document.getElementById('imageProcessingModal')) return;

        imageProcessingModal = document.createElement('div');
        imageProcessingModal.className = 'modal';
        imageProcessingModal.id = 'imageProcessingModal';
        imageProcessingModal.innerHTML = `
            <div class="modal-content">
                <span class="modal-close" title="Close (Esc)">×</span>
                <h3>Process Image for Canvas</h3>

                <div class="preview-container">
                    <div class="preview-wrapper" id="previewWrapper">
                        <canvas id="imagePreviewCanvas"></canvas> {/* Canvas now positioned via JS */}
                    </div>
                    <div class="preview-controls">
                        <button class="zoom-button" id="zoomOutBtn" title="Zoom Out">-</button>
                        <span class="zoom-value" id="zoomValueDisplay">100%</span>
                        <button class="zoom-button" id="zoomInBtn" title="Zoom In">+</button>
                    </div>
                    <div class="preview-instructions">
                        Drag to pan • Zoom • Center square will be used
                    </div>
                </div>

                <div class="processing-options">
                    <label for="thresholdSlider">Threshold: <span id="thresholdValueDisplay">127</span></label>
                    <input type="range" id="thresholdSlider" min="0" max="255" value="127">

                    <label for="inversionCheckbox">
                        <input type="checkbox" id="inversionCheckbox"> Invert Black/White
                    </label>
                </div>

                <div class="button-group">
                    <button id="cancelProcessingBtn" class="button button-secondary">Cancel</button>
                    <button id="confirmProcessingBtn" class="button button-primary">Apply to Canvas</button>
                </div>
            </div>`;
        document.body.appendChild(imageProcessingModal);

        // --- Get References --- (Code identical to v2)
        previewCanvas = document.getElementById('imagePreviewCanvas');
        previewWrapper = document.getElementById('previewWrapper');
        thresholdSlider = document.getElementById('thresholdSlider');
        thresholdValueDisplay = document.getElementById('thresholdValueDisplay');
        inversionCheckbox = document.getElementById('inversionCheckbox');
        zoomInBtn = document.getElementById('zoomInBtn');
        zoomOutBtn = document.getElementById('zoomOutBtn');
        zoomValueDisplay = document.getElementById('zoomValueDisplay');
        confirmBtn = document.getElementById('confirmProcessingBtn');
        cancelBtn = document.getElementById('cancelProcessingBtn');
        modalCloseBtn = imageProcessingModal.querySelector('.modal-close');

        if (!previewCanvas || !previewWrapper || !thresholdSlider /* ... and so on */) {
            console.error("Failed to find all elements within the image processing modal!");
            if (imageProcessingModal) imageProcessingModal.remove();
            imageProcessingModal = null;
            return;
        }

        previewCtx = previewCanvas.getContext('2d', { willReadFrequently: true });
        previewCtx.imageSmoothingEnabled = false;

        // --- Event Listeners --- (Pan listeners modified in v3)
        modalCloseBtn.addEventListener('click', closeModal);
        cancelBtn.addEventListener('click', closeModal);
        confirmBtn.addEventListener('click', handleConfirmProcessing); // Modified in v3
        thresholdSlider.addEventListener('input', handleThresholdChange);
        inversionCheckbox.addEventListener('change', handleInversionChange);
        zoomInBtn.addEventListener('click', handleZoomIn);
        zoomOutBtn.addEventListener('click', handleZoomOut);

        // Pan listeners (Now modify sourceOffset, not element style)
        previewWrapper.addEventListener('mousedown', handlePanStart);
        window.addEventListener('mousemove', handlePanMove);
        window.addEventListener('mouseup', handlePanEnd);
        previewWrapper.addEventListener('touchstart', handlePanStart, { passive: false });
        window.addEventListener('touchmove', handlePanMove, { passive: false });
        window.addEventListener('touchend', handlePanEnd);

        imageProcessingModal.addEventListener('click', (e) => {
            if (e.target === imageProcessingModal) closeModal();
        });
    }

    // --- Image Processing Logic (Panning and UpdatePreview heavily modified) ---

    function handleFileSelect(event) {
        // --- Code identical to v2 ---
        const file = event.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (e) => {
            originalImage = new Image();
            originalImage.onload = () => {
                console.log(`Image loaded: ${originalImage.width}x${originalImage.height}`);
                // Reset state before showing
                zoomLevel = 1.0;
                sourceOffset = { x: 0, y: 0 }; // Reset pan
                thresholdSlider.value = 127;
                thresholdValueDisplay.textContent = '127';
                inversionCheckbox.checked = false;
                isDragging = false;

                updatePreview(); // Initial draw
                openModal();
            };
            originalImage.onerror = () => {
                console.error("Failed to load image.");
                alert("Error: Could not load the selected image file.");
                resetFileInput();
            };
            originalImage.src = e.target.result;
        };
        reader.onerror = () => {
            console.error("Failed to read file.");
            alert("Error: Could not read the selected file.");
            resetFileInput();
        };
        reader.readAsDataURL(file);
    }

    // *** MAJOR CHANGES in updatePreview for new Panning Logic ***
    function updatePreview() {
        if (!originalImage || !previewCtx || !previewWrapper) return;

        const containerSize = PREVIEW_CONTAINER_SIZE;

        // Calculate the size of the source region in the original image needed
        // to fill the preview container at the current zoom level.
        const sourceViewSize = containerSize / zoomLevel;

        // Determine the *centered* source rectangle in the original image
        const imgCenterX = originalImage.width / 2;
        const imgCenterY = originalImage.height / 2;

        // Apply the sourceOffset (pan) to the center point
        // sourceOffset is in original image pixel coordinates
        let sourceX = imgCenterX - (sourceViewSize / 2) + sourceOffset.x;
        let sourceY = imgCenterY - (sourceViewSize / 2) + sourceOffset.y;

        // Clamp source coordinates to stay within the original image boundaries
        sourceX = Math.max(0, Math.min(originalImage.width - sourceViewSize, sourceX));
        sourceY = Math.max(0, Math.min(originalImage.height - sourceViewSize, sourceY));

        // Clamp sourceOffset based on the clamped sourceX/Y to prevent drift
        sourceOffset.x = sourceX - (imgCenterX - sourceViewSize / 2);
        sourceOffset.y = sourceY - (imgCenterY - sourceViewSize / 2);

        // Set preview canvas size to match container - it doesn't need to scale anymore
        previewCanvas.width = containerSize;
        previewCanvas.height = containerSize;

        // Clear previous drawing
        previewCtx.clearRect(0, 0, containerSize, containerSize);
        // Optional: Fill with a background color if needed
        // previewCtx.fillStyle = '#222';
        // previewCtx.fillRect(0, 0, containerSize, containerSize);

        // Draw the calculated portion of the original image onto the preview canvas
        previewCtx.drawImage(
            originalImage,
            sourceX, sourceY, sourceViewSize, sourceViewSize, // Source rectangle from original image
            0, 0, containerSize, containerSize              // Destination rectangle (entire preview canvas)
        );

        // Apply threshold and inversion to the drawn preview
        applyThresholdToPreview(); // Operates on previewCanvas

        // --- NO Canvas Positioning needed anymore ---
        // previewCanvas.style.left = `...`; // REMOVED
        // previewCanvas.style.top = `...`; // REMOVED

        // Update zoom display
        zoomValueDisplay.textContent = `${Math.round(zoomLevel * 100)}%`;

        // Draw the selection overlay *last*
        // This overlay is now purely visual and fixed on the preview canvas center
        drawSelectionOverlay();
    }


    function applyThresholdToPreview() {
        // --- Code identical to v2 ---
         if (!previewCtx) return;
        const threshold = parseInt(thresholdSlider.value);
        const invert = inversionCheckbox.checked;
        const width = previewCanvas.width; // Should be PREVIEW_CONTAINER_SIZE
        const height = previewCanvas.height; // Should be PREVIEW_CONTAINER_SIZE

        try {
            const imageData = previewCtx.getImageData(0, 0, width, height);
            const data = imageData.data;

            for (let i = 0; i < data.length; i += 4) {
                const r = data[i]; const g = data[i+1]; const b = data[i+2];
                const gray = (r + g + b) / 3; // Simple avg grayscale
                let binaryValue = gray >= threshold ? 255 : 0;
                if (invert) { binaryValue = 255 - binaryValue; }
                data[i] = data[i+1] = data[i+2] = binaryValue;
            }
            previewCtx.putImageData(imageData, 0, 0);
        } catch (error) {
            console.error("Error processing preview image data:", error);
        }
    }

    function drawSelectionOverlay() {
        // --- Simplified: Draws a fixed overlay on the preview canvas ---
        if (!previewCtx) return;
        const size = previewCanvas.width; // Overlay covers the whole preview now

        previewCtx.save();
        previewCtx.strokeStyle = 'rgba(255, 100, 0, 0.8)';
        previewCtx.lineWidth = 2;
        previewCtx.setLineDash([6, 4]);
        // Draw rect around the entire preview canvas edge
        previewCtx.strokeRect(1, 1, size - 2, size - 2); // Inset slightly
        previewCtx.restore();
    }


    function handleThresholdChange() {
        thresholdValueDisplay.textContent = thresholdSlider.value;
        updatePreview(); // Redraw with new threshold
    }

    function handleInversionChange() {
        updatePreview(); // Redraw with inversion state toggled
    }

    // Zoom handlers now need to potentially adjust sourceOffset if zooming on a panned area
    function handleZoomIn() {
        const oldZoom = zoomLevel;
        zoomLevel = Math.min(zoomLevel + 0.25, 5.0);
        // Adjust offset slightly to keep the center point visually similar
        sourceOffset.x *= (zoomLevel / oldZoom);
        sourceOffset.y *= (zoomLevel / oldZoom);
        updatePreview();
    }

    function handleZoomOut() {
        const oldZoom = zoomLevel;
        zoomLevel = Math.max(zoomLevel - 0.25, 0.25);
         // Adjust offset slightly
        sourceOffset.x *= (zoomLevel / oldZoom);
        sourceOffset.y *= (zoomLevel / oldZoom);
        updatePreview();
    }

    // *** NEW Panning Handlers ***
    function handlePanStart(e) {
        if (!originalImage) return;
        e.preventDefault();
        isDragging = true;
        const pos = getEventClientPos(e);
        dragStart = { x: pos.x, y: pos.y };
        dragStartSourceOffset = { x: sourceOffset.x, y: sourceOffset.y }; // Store offset at start
        previewWrapper.style.cursor = 'grabbing';
    }

    function handlePanMove(e) {
        if (!isDragging || !originalImage) return;
        e.preventDefault();
        const pos = getEventClientPos(e);
        const deltaX = pos.x - dragStart.x;
        const deltaY = pos.y - dragStart.y;

        // Convert screen pixel delta to original image pixel delta
        const sourceDeltaX = deltaX / zoomLevel;
        const sourceDeltaY = deltaY / zoomLevel;

        // Update sourceOffset based on the initial offset + delta
        // Invert delta because dragging right should move the image source left
        sourceOffset.x = dragStartSourceOffset.x - sourceDeltaX;
        sourceOffset.y = dragStartSourceOffset.y - sourceDeltaY;

        // Clamping happens inside updatePreview
        updatePreview();
    }

    function handlePanEnd(e) {
        if (!isDragging) return;
        isDragging = false;
        previewWrapper.style.cursor = 'move';
        // Final update ensures clamping is applied
        updatePreview();
    }

    function getEventClientPos(e) {
        // --- Code identical to v2 ---
        if (e.touches && e.touches.length > 0) {
            return { x: e.touches[0].clientX, y: e.touches[0].clientY };
        } else if (e.changedTouches && e.changedTouches.length > 0) {
            return { x: e.changedTouches[0].clientX, y: e.changedTouches[0].clientY };
        }
        return { x: e.clientX, y: e.clientY };
    }


    // *** MAJOR CHANGES in handleConfirmProcessing to avoid marching ants ***
    function handleConfirmProcessing() {
        console.log("Confirming image processing v3...");
        if (!originalImage) {
             console.error("Cannot apply: Original image is not available.");
             closeModal();
             return;
        }

        // 1. Create a temporary 256x256 canvas
        const finalCanvas = document.createElement('canvas');
        finalCanvas.width = 256;
        finalCanvas.height = 256;
        const finalCtx = finalCanvas.getContext('2d');
        finalCtx.imageSmoothingEnabled = false; // Pixelated result

        // 2. Calculate the *final source rectangle* from the original image
        //    based on the current zoom and pan (sourceOffset).
        const finalSourceViewSize = PREVIEW_CONTAINER_SIZE / zoomLevel;
        const imgCenterX = originalImage.width / 2;
        const imgCenterY = originalImage.height / 2;

        let finalSourceX = imgCenterX - (finalSourceViewSize / 2) + sourceOffset.x;
        let finalSourceY = imgCenterY - (finalSourceViewSize / 2) + sourceOffset.y;

        // Clamp final source rect one last time
        finalSourceX = Math.max(0, Math.min(originalImage.width - finalSourceViewSize, finalSourceX));
        finalSourceY = Math.max(0, Math.min(originalImage.height - finalSourceViewSize, finalSourceY));

        console.log(`Final draw: SourceRect(x:${finalSourceX.toFixed(1)}, y:${finalSourceY.toFixed(1)}, size:${finalSourceViewSize.toFixed(1)}) from Original(${originalImage.width}x${originalImage.height})`);

        // 3. Draw DIRECTLY from originalImage to the 256x256 finalCanvas
        finalCtx.drawImage(
            originalImage,
            finalSourceX, finalSourceY, finalSourceViewSize, finalSourceViewSize, // Source rect from original
            0, 0, 256, 256 // Destination (entire final canvas)
        );

        // 4. Apply threshold and inversion to the finalCanvas *after* drawing
        const threshold = parseInt(thresholdSlider.value);
        const invert = inversionCheckbox.checked;
        try {
            const finalImageData = finalCtx.getImageData(0, 0, 256, 256);
            const data = finalImageData.data;
            for (let i = 0; i < data.length; i += 4) {
                 const r = data[i]; const g = data[i+1]; const b = data[i+2];
                 const gray = (r + g + b) / 3;
                 let binaryValue = gray >= threshold ? 255 : 0;
                 if (invert) { binaryValue = 255 - binaryValue; }
                 data[i] = data[i+1] = data[i+2] = binaryValue;
            }
            finalCtx.putImageData(finalImageData, 0, 0); // Put processed data back
        } catch (error) {
             console.error("Error processing final image data:", error);
             closeModal(); // Abort on error
             return;
        }

        // 5. Get pixel data from the processed finalCanvas
        const finalImageData = finalCtx.getImageData(0, 0, 256, 256); // Get it again
        const data = finalImageData.data;

        // 6. Update the main application's grid data
        const gridData = window.pixelEditorApp.getGridData();
        let pixelsSet = 0;
        for (let y = 0; y < 256; y++) {
            for (let x = 0; x < 256; x++) {
                const index = (y * 256 + x) * 4;
                gridData[y][x] = (data[index] > 127) ? 1 : 0; // 1 for white, 0 for black
                if (gridData[y][x] === 1) pixelsSet++;
            }
        }
        console.log(`Applied ${pixelsSet} white pixels to gridData.`);

        // 7. Trigger redraw and URL update in the main app
        window.pixelEditorApp.updateCanvas();

        // 8. Close the modal
        closeModal();
    }

    // --- Modal Management & Helpers --- (Identical to v2)

    function openModal() {
        if (!imageProcessingModal) { console.error("Modal element does not exist."); return; }
        imageProcessingModal.classList.add('visible');
        document.addEventListener('keydown', handleEscKey);
        console.log('Image processing modal opened.');
    }

    function closeModal() {
        if (!imageProcessingModal) return;
        imageProcessingModal.classList.remove('visible');
        document.removeEventListener('keydown', handleEscKey);
        resetFileInput();
        originalImage = null; // Release image reference
        isDragging = false; // Ensure dragging state is reset
        console.log('Image processing modal closed.');
    }

    function handleEscKey(e) {
        if (e.key === 'Escape') { closeModal(); }
    }

    function resetFileInput() {
        if (fileInput) { fileInput.value = ''; }
    }

    // --- Initialize UI ---
    createStyles();
    createSettingsIconAndMenu();
    createImageProcessingModal();

    console.log('Utilities v3 initialization complete.');
}

// Initialization is triggered by 'load' event in board.html