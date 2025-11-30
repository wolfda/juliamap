# Julia and Mandelbrot Set Maths

## Iteration Basics

The fundamental recurrence is:

$$
z_{n+1} = z_n^2 + c
$$

The Mandelbrot and Julia sets are based on different initial conditions. Let's map the screen coordinate $(x, y)$ to the complex plane, where $p = x + iy$:

Mandelbrot set:

$$
\begin{cases}
c = p \\
z_0 = 0 \\
z_{n+1} = z_n^2 + c
\end{cases}
$$

Julia set:

$$
\begin{cases}
c = q \\
z_0 = p \\
z_{n+1} = z_n^2 + c
\end{cases}
$$

for each point $q$ in the Mandelbrot set.

The escape velocity is expressed as $n$ for which $|z_n| > 2$, or its continuous form $\nu$:

$$
\nu = n + 1 - \log_2(\log_2 |z_n|)
$$

## Perturbation Theory

For deep zoom levels, computing the series in f32 will overflow. This section explains the mathematical derivation of the perturbation method used to render Mandelbrot and Julia sets at extreme zoom levels. It starts from the basic iteration and arrives at the perturbation formula.

---

### 1. Base Iteration

We introduce:

- a **reference parameter** $c_0$
- a **reference orbit** $z_n$ computed in high precision

Each pixel uses:

$$
c = c_0 + \Delta c
$$

and its orbit is expressed as:

$$
w_n = z_n + \Delta z_n
$$

where:

- $z_n$ = reference orbit value
- $\Delta z_n$ = perturbation (computed in float precision)

---

### 2. Deriving the Perturbation Recurrence

Start with the pixel iteration:

$$
w_{n+1} = w_n^2 + c_0 + \Delta c
$$

Subtract the reference iteration:

$$
z_{n+1} = z_n^2 + c_0
$$

Take the difference:

$$
\Delta z_{n+1} = w_{n+1} - z_{n+1}
$$

Substitute definitions:

$$
\Delta z_{n+1} = (z_n + \Delta z_n)^2 - z_n^2 + \Delta c
$$

Expand:

$$
= z_n^2 + 2 z_n \Delta z_n + (\Delta z_n)^2 - z_n^2 + \Delta c
$$

Simplify:

$$
\boxed{
\Delta z_{n+1} = 2 \Delta z_n (z_n  + \Delta z_n ) + \Delta c
}
$$

This is the **exact perturbation formula**.
