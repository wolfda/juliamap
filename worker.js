// fractal-worker.js

onmessage = function (e) {
  const { width, height, centerX, centerY, zoom } = e.data;

  // We’ll track totalIterations to estimate FLOPS
  let totalIterations = 0;

  // Typical CPU fractal iteration
  const maxIter = 500;
  const imageDataArray = new Uint8ClampedArray(width * height * 4);

  for (let py = 0; py < height; py++) {
    // Convert py to fractal coords
    for (let px = 0; px < width; px++) {
      // Map (px, py) -> complex plane
      const scale = 4.0 / (width * zoom);
      const x0 = centerX + (px - width / 2) * scale;
      const y0 = centerY - (py - height / 2) * scale;

      let x = 0;
      let y = 0;
      let iteration = 0;
      for (iteration = 0; iteration < maxIter; iteration++) {
        const x2 = x * x - y * y + x0;
        const y2 = 2.0 * x * y + y0;
        x = x2;
        y = y2;

        // If we escape radius > 2, break out
        if ((x * x + y * y) > 4.0) {
          break;
        }
      }

      // iteration count used => iteration + 1
      totalIterations += (iteration + 1);

      // Color the pixel (same as before)
      const idx = (py * width + px) * 4;
      if (iteration === maxIter) {
        // inside
        imageDataArray[idx + 0] = 0;
        imageDataArray[idx + 1] = 0;
        imageDataArray[idx + 2] = 0;
        imageDataArray[idx + 3] = 255;
      } else {
        const c = 255 - Math.floor((iteration / maxIter) * 255);
        imageDataArray[idx + 0] = c;
        imageDataArray[idx + 1] = c;
        imageDataArray[idx + 2] = 255;
        imageDataArray[idx + 3] = 255;
      }
    }
  }

  // Return the full image plus iteration/time info
  postMessage({
    width,
    height,
    imageDataArray,
    totalIterations
  });
};
