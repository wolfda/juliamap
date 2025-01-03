/**
 * fractal-worker.js
 * 
 * This worker receives { width, height, centerX, centerY, zoom }
 * and returns image data for the Mandelbrot set at that viewport.
 * 
 * For demonstration, it uses a simple iteration approach with
 * a maximum of ~200-1000 iterations. This is easily extended or
 * replaced by more advanced algorithms or colorings.
 */

self.onmessage = (e) => {
    const { width, height, centerX, centerY, zoom } = e.data;
  
    const maxIter = 500; // For demonstration. Increase for better detail.
    // We'll map screen coords to the complex plane:
    // The entire set extends roughly from x ∈ [-2, +2], y ∈ [-2, +2].
    // At zoom=1, the width in the complex plane is 4. 
    // => scale in real units = 4 / width (for zoom=1). 
    // => for general zoom: scale = (4 / width) / zoom
    const scale = 4 / width / zoom;
  
    // Precompute some color lookup if desired, or compute on the fly
    // Create a typed array for the image data (RGBA for each pixel)
    const imageDataArray = new Uint8ClampedArray(width * height * 4);
  
    for (let py = 0; py < height; py++) {
      // Map py -> imaginary coordinate
      // We want the center of the image to be centerY
      // So row py offset from height/2
      const cy = centerY - (py - height / 2) * scale;
  
      for (let px = 0; px < width; px++) {
        // Map px -> real coordinate
        const cx = centerX + (px - width / 2) * scale;
  
        // Now do the Mandelbrot iteration
        let zx = 0, zy = 0;
        let iter = 0;
        while (zx*zx + zy*zy < 4 && iter < maxIter) {
          const xTemp = zx*zx - zy*zy + cx;
          zy = 2 * zx * zy + cy;
          zx = xTemp;
          iter++;
        }
  
        // Color based on iter
        const idx = (py * width + px) * 4;
        if (iter === maxIter) {
          // Inside the set => black
          imageDataArray[idx] = 0;
          imageDataArray[idx + 1] = 0;
          imageDataArray[idx + 2] = 0;
          imageDataArray[idx + 3] = 255; // alpha
        } else {
          // Outside => pick some color
          // Example: a simple gradient
          const c = 255 - Math.floor((iter / maxIter) * 255);
          imageDataArray[idx] = c;
          imageDataArray[idx + 1] = c;
          imageDataArray[idx + 2] = 255;
          imageDataArray[idx + 3] = 255; // alpha
        }
      }
    }
  
    // Post back to main thread
    self.postMessage({
      width,
      height,
      imageDataArray
    }, [imageDataArray.buffer]);
  };
  