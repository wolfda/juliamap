Can you implement JuliaMap web application following this spec:

# Julia Map

Julia Map is an application to browse the Mandelbrot set and Julia sets. Here are the high level specifications of the application:

## User Interface

### Controls

The user interface looks similar to a Map interface: It start with the overall Mandelbrot set, and the user can pan and zoom into the set:

- the UI is minimalist, showing a map of mandelbrot on the whole page, no other controls.
- the initial viewport shows the whole mandelbrot set from [-2, 2]
- when the user clicks and drags on the map, it translate the map accordingly
- the mouse wheel controls zooming in/out at the location of the mouse pointer
- alternatively, the touch pad should work as well, and touch events on a tablet or phone should also work 

The user should be able to zoom without any limit into the set.

### Statistics

A small gauge shows in the lower right corner showing number of flop incurred by the background computation. flop can be approximated by flop ~= 6 * iteration, since each iteration takes 6 floating point operations.

### URL

The browser URL models the full state of the current viewport. It includes the following parameters:

- (x, y): the coordinate of the center in the complex plane. x for real number, y for imaginary numbers.
- z: the zoom level. It could be any number, integer or fractional

## Implementation

Here are some details of the implementations of the application:

### Rendering

While panning/zooming the map, a coarse preview is rendered. The preview is computed as follows:
- with GPU 1:1 resolution, for any zoom level that can be rendered with enough precision with `highp float` (zoom < 256073)
- with CPU at 1:8 resolution, for any zoom level beyond 256073

Once panning/zooming is done, a refined image is computed in the background, at 1:1 resolution. As soon as a new panning/zooming event starts, any ongoing rendering is canceled.