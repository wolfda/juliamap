import { getEscapeVelocity } from "./julia.js"

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
      const scaleFactor = 4.0 / width * Math.pow(2, -zoom);
      const x0 = centerX + (px - width / 2) * scaleFactor;
      const y0 = centerY - (py - height / 2) * scaleFactor;

      let escapeVelocity = getEscapeVelocity(x0, y0, maxIter);

      // iteration count used => escapeVelocity + 1
      totalIterations += escapeVelocity + 1;

      // Calculate index in this chunk's buffer
      // row offset: (py - startY)
      const rowOffset = py - startY;
      const idx = (rowOffset * width + px) * 4;

      if (escapeVelocity === maxIter) {
        // inside
        imageDataArray[idx + 0] = 0;
        imageDataArray[idx + 1] = 0;
        imageDataArray[idx + 2] = 0;
        imageDataArray[idx + 3] = 255;
      } else {
        // outside => color
        const c = 255 - Math.floor((escapeVelocity / maxIter) * 255);
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
