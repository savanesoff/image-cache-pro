# image-cache-pro

`JavaScript Browser` application library for ultimate Web app image (load, ple-load, caching) control, as well as detailed `RAM` and `GPU` memory usage control and monitoring.

## Table of Contents

- [Use Case](#use-case)
- [Origin](#origin)
- [Features](#features)
- [Installation](#installation)
- [Usage](#usage)
  - [Basic Example](#basic-example)
  - [Advanced Example](#advanced-example)
- [API](#api)
  - [ImageCache](#imagecache)
  - [Events](#events)
- [Contributing](#contributing)
- [License](#license)

## Use case

Any web based application with a heavy use of Image assets, such as Image Gallery/Catalogue, Product Showcase or Image Editing, intended to run on a wide range of platforms limited by `HW specs` and/or available `resources` such as `RAM` and/or `GPU` cache/memory and `CPU`.

If you care about the performance of your application, and have a nobel goal of being kind to your end user experience, their computing resources, the responsiveness of your application - this library is for you!

## Origin

We're all too familiar with a concept of a client side caching. We do it all the time when it comes to the server data requests to ensure same requests from your app are cached in `JavaScript`/`Browser` to optimize network traffic load and responsiveness of your application. Everybody wins: user (no wait time), cloud (cutting costs of compute), user's network load, their machine resources etc... etc... All great things and there are lots of libraries addressing this very issue.

But have you ever wondered what happens when your app requests an Image from a server? From my research and experience, the Browser caches the Image data, but, we have no access to it, no control over it, we don't know if the Image data was evicted from cache or how much memory was consumed, no way to monitor it, no way to manage it. If Browser decides to evict the Image data from cache, it will be re-requested from the server, and the whole process repeats itself. This is not good for the user experience, not good for the network traffic, not good for the server, not good for the Browser, not good for the user's machine resources.

And this is where this library comes in.

## Features

`image-cache-pro` library provides the following features:

- Image pre-loading
- Image caching
- Image RAM usage monitoring
- Image GPU memory usage monitoring
- Image RAM eviction control
- Image GPU memory eviction control
- Image RAM persistence control
- Image GPU memory persistence control
- Event driven architecture
- HW specs configuration

## RAM Usage Monitoring

`image-cache-pro` library provides a way to monitor the RAM usage of the images loaded by the application. This is useful to ensure that the application does not consume too much memory and slow down the system.

Image data usage consists of two data footprints:

- `Compressed` image data footprint:
  - Image data as it was received from the server which includes IMage type compression (e.g. `JPEG`, `PNG`, `WEBP`, etc...)
- `Uncompressed` image data footprint:
  - Image data after it has been decompressed by the browser in order to display it't bitmap representation on the screen. An `rgb` or `rgba` bitmap representation of the image. (gray scale, color, alpha channel, etc...)

Both of these data are stored in the `RAM` and this library provides a way to monitor both of these data footprints to give you a complete picture of the memory usage of the images loaded by the application.

## GPU Memory Usage Monitoring

`image-cache-pro` library provides a way to monitor the GPU memory usage of the images loaded by the application. This is useful to ensure that the application does not consume too much memory and slow down the system. Different Browsers handle this bit differently, where most desktop browsers will create a bitmap data of the image corresponding to actual pixels rendered on the screen, and store it in the GPU memory, while other browsers will store the entire `Uncompressed` image data in the GPU memory, and render it on the screen using GPU scaling approach. This distinction is important to understand when it comes to the GPU memory usage monitoring and is defined by `gpuFullMode` configuration option. Where:

- `gpuFullMode: true` - will monitor the entire `Uncompressed` image data footprint in the GPU memory
- `gpuFullMode: false` - will monitor only the rendered bitmap size data footprint in the GPU memory

This distinction is important to understand when it comes to the GPU memory usage and having understanding of the actual memory usage of the images loaded by the application.

### Example

While rendering a 4k image (RGBA) as `100x100` pixels on the screen, the GPU memory usage will be different depending on the browser, and with `gpuFullMode` configuration option, we can distinguish a GPU memory footprint:

- In `gpuFullMode: true` the GPU memory usage will be the same as the `Uncompressed` image data footprint size. Which means the GPU memory usage will contain the entire `Uncompressed` image data, which in MB is `3840x2160x4` bytes = `33.18 MB`.
  - This is because the entire image data is stored in the GPU memory and rendered on the screen using GPU scaling approach.
- In `gpuFullMode: false` the GPU memory usage will be the same as the rendered RGBA bitmap size data. Which means the GPU memory usage will be the same as the `100x100` RGBA image size, which in MB is 100x100x4 bytes = `0.39 MB`.

# Installation

```sh
<npm, pnpm, yarn> install image-cache-pro
```
