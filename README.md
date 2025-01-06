# Julia Map

Julia Map is an application to browse the [Julia set](https://en.wikipedia.org/wiki/Julia_set) and [Mandelbrot set](https://en.wikipedia.org/wiki/Mandelbrot_set). Here are the high level specifications of the application.

## User Interface

### Controls

The user interface is implemented like a map interface. It starts with the overall Mandelbrot set, and provides controls to pan and zoom into the set.

- the UI is minimalist, showing a rendering of the fractal in full screen, no other controls.
- the initial viewport shows the whole mandelbrot set from [(-2, -2), (2, 2)] complex coordinates.
- panning is done by clicking and holding the map, which translates the map following the mouse pointer.
- zoom is controlled with mouse, trackpad, or touch screen events.

### Statistics

A small control on the upper right corner shows number of flops incurred by the background computation. Flops is approximated by `flop ~= 6 * iterations`, since each iteration takes 6 floating point operations. We also display how the image was rendered (webgl / webgpu / cpu).

### URL

The browser URL models the full state of the current viewport. It includes the following parameters:

- (x, y): the coordinate of the center in the complex plane. x for the real coordinate, y for the imaginary coordinate.
- z: the zoom level. It could be any number, integer or fractional

## Implementation

### 3 rendering engines

The rendering can be done with 3 different methods:

- WebGPU: using a fragment shader to compute the escape values with 64-bit floating point numbers.
- WebGL: using a fragment shader to compute the mandelbrot escape values with 32-bit floating point numbers.
- CPU: the rendering is delegated to a web worker.

The rendering engin for the current viewport is choosen based on capabilities of the current platform, in the following order:

1. WebGPU if available. This is experimental and not widely available on current browsers
2. WebGL, down to zoom ~256073x, which is the limit we can render accurate image with 32-bit integers
3. CPU for all other cases. While panning and zooming, a low resolution image will first be computed at 1:8 scale, followed by a full resolutation rendering
