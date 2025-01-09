onmessage = function (e) {
  const {
    width,
    height,
    centerX,
    centerY,
    zoom,
    startY,
    endY,
  } = e.data;

  // We’ll track totalIterations to estimate FLOPS
  let totalIterations = 0;

  const maxIter = 500;
  
  // Only allocate enough space for the rows we handle
  const rowsCount = endY - startY; 
  const imageDataArray = new Uint8ClampedArray(width * rowsCount * 4);

  for (let py = startY; py < endY; py++) {
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

      // Calculate index in this chunk's buffer
      // row offset: (py - startY)
      const rowOffset = py - startY;
      const idx = (rowOffset * width + px) * 4;

      if (iteration === maxIter) {
        // inside
        imageDataArray[idx + 0] = 0;
        imageDataArray[idx + 1] = 0;
        imageDataArray[idx + 2] = 0;
        imageDataArray[idx + 3] = 255;
      } else {
        // outside => color
        const c = 255 - Math.floor((iteration / maxIter) * 255);
        imageDataArray[idx + 0] = c;
        imageDataArray[idx + 1] = c;
        imageDataArray[idx + 2] = 255;
        imageDataArray[idx + 3] = 255;
      }
    }
  }

  // Return partial image plus iteration/time info
  postMessage({
    startY,
    endY,
    imageDataArray,
    totalIterations
  });
};
