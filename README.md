[![by Protosus](https://raw.githubusercontent.com/savanesoff/protosus/main/public/icons/by-protosus.svg)](https://github.com/savanesoff/image-cache-pro)

# image-cache-pro

[![Github](https://badgen.net/badge/Protosus/image-cache-pro?color=purple&icon=github)](https://github.com/savanesoff/image-cache-pro)
[![Li](https://badgen.net/badge/Sponsored%20by/Oregan%20Networks?color=blue)](https://oregan.net/)
[![Build Status](https://github.com/savanesoff/image-cache-pro/actions/workflows/publish.yaml/badge.svg?branch=main&event=push)](https://github.com/savanesoff/image-cache-pro/actions/workflows/publish.yaml)
[![npm version](https://badge.fury.io/js/image-cache-pro.svg)](https://badge.fury.io/js/image-cache-pro)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![Li](https://badgen.net/badge/savanesoff/LI?color=blue)](https://www.linkedin.com/in/samvel-avanesov)

`JavaScript Browser` application library for ultimate Web app image (load, ple-load, caching) control, as well as detailed `RAM` and `GPU` memory usage control and monitoring.

[![Validator](https://raw.githubusercontent.com/savanesoff/image-cache-pro/main/public/image-cache-demo.gif)](https://savanesoff.github.io/image-cache-pro)

## Table of Contents

## Use case

Memory management and performance optimization of web based applications with heavy use of Image assets.

### Memory Management

Any web based application with a heavy use of Image assets, such as Image Gallery/Catalogue, Product Showcase or Image Editing, intended to run on a wide range of platforms limited by `HW specs` and/or available `resources` such as `RAM` and/or `GPU` cache/memory and `CPU`. This library provides a way to manage the memory usage of the images loaded by the application, and ensure that the application does not consume too much memory and slow down the system.

### Performance (FPS)

Rendering multiple images at once can lead to rendering performance issues (FPS drop). The more images and the higher image resolution, the bigger the impact. This is because browser has to push a lot of Image data to the GPU memory, and the GPU has to render it on the screen. This library provides a way to pre-render images before they are ready to be displayed on the screen, and ensure that the application runs smoothly and efficiently with minimal FPS drop.

## Origin

We're all too familiar with a concept of a client side caching. We do it all the time when it comes to the server data requests to ensure same requests from your app are cached in `JavaScript`/`Browser` to optimize network traffic load and responsiveness of your application. Everybody wins: user (no wait time), cloud (cutting costs of compute), user's network load, their machine resources etc... etc... All great things and there are lots of libraries addressing this very issue.

But have you ever wondered what happens when your app requests an Image from a server? From my research and experience, the Browser caches the Image data, but, we have no access to it, no control over it, we don't know if the Image data was evicted from cache or how much memory was consumed, no way to monitor it, no way to manage it. If Browser decides to evict the Image data from cache, it will be re-requested from the server, and the whole process repeats itself. This is not good for the user experience, not good for the network traffic, not good for the server, not good for the Browser, not good for the user's machine resources.

And this is where this library comes in.

## Features

`image-cache-pro` library provides the following features:

- Image pre-loading
- Image pre-rendering
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

`image-cache-pro` library provides a way to monitor the `RAM` usage of the images loaded by the application. This is useful to ensure that the application does not consume too much memory and slow down the system.

Image data usage consists of two data footprints:

- `Compressed` image data footprint:
  - Image data as it was received from the server which depends on Image type compression (e.g. `JPEG`, `PNG`, `WEBP`, etc...). This is what browser downloads and stores in the `RAM` as is.
- `Uncompressed` image data footprint:
  - Image data after it has been decompressed by the browser in order to display it't bitmap representation on the screen. An `rgb` or `rgba` bitmap representation of the image. (gray scale, color, alpha channel, etc...)

Both of these data are stored in the `RAM` and this library provides a way to monitor both of these data footprints to give you a complete picture of the memory usage of the images loaded by the application.

## GPU Memory Usage Monitoring

`image-cache-pro` library provides a way to monitor the `GPU` memory usage of the images loaded by the application. This is useful to ensure that the application does not consume too much memory and slow down the system. Different Browsers handle this bit differently, where most desktop browsers will create a bitmap data of the image corresponding to actual pixels rendered on the screen, and store it in the `GPU` memory, while other browsers will store the entire `Uncompressed` image data in the GPU memory, and render it on the screen using GPU scaling approach. This distinction is important to understand when it comes to the GPU memory usage monitoring and is defined by `gpuFullMode` configuration option. Where:

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

# Usage

Create a main cache controller instance and configure it with the desired settings.

## Controller

```ts
import { Controller } from 'image-cache-pro';

const controller = new Controller({
  // Configuration options
  // ...
  RAM: 500, // units of memory for RAM usage
  GPU: 300, // units of memory for GPU usage
  units: 'MB', // 'KB', 'MB', 'GB' units of memory for RAM and GPU
  loaders: 4, // number of concurrent image loaders - max 6
});

// add event listeners if you must
controller.on('update', (event: ControllerEvent<'update'>) => {
  console.log('Controller update event:', event);
});

controller.on('ram-overflow', (event: ControllerEvent<'ram-overflow'>) => {
  console.log('Controller RAM overflow event:', event); // take action to prevent RAM overflow
});

controller.on('video-overflow', (event: ControllerEvent<'video-overflow'>) => {
  console.log('Controller GPU overflow event:', event); // take action to prevent GPU overflow
});
```

## Bucket

Then anywhere in you application, create image Bucket to handle images in groups. Think of Buckets as a way to group images that you want to load, cache, monitor, and control, say for each page, or each section of your application.

```ts
import { Bucket } from 'image-cache-pro';

const bucket = new Bucket({
  // Configuration options
  // ...
  controller, // pass the controller instance
  lock: true, // lock the bucket to prevent eviction of images in you need the data to persist in the cache
  name: 'Recent Images', // name of the bucket - optional, good for debugging
});

// wait for all bucket requests to be pre-rendered do you can trigger smooth rendering of the images on the screen
bucket.on('rendered', (event: BucketEvent<'rendered'>) => {
  console.log('All bucket requests are pre-rendered:', event);
  // ex: myGallery.fadeIn();
});

// you can clear (release) bucket content by calling clear method
myGallery.on('exit', event => {
  bucket.clear();
  console.log('Bucket cleared:', event);
});
```

## RenderRequest

Now you're ready to load images using `RenderRequest` method, which is a way to request an image to be loaded, cached, monitored, and controlled by the `image-cache-pro` library. You must pass set its image size to let the library know how to handle the image data.

```ts

const urls = [...]; // array of image urls

urls.forEach(url => {
  const request = new RenderRequest({
    // Configuration options
    // ...
    bucket, // pass the bucket instance
    url, // image url
    size: { width: 100, height: 100 }, // image size - required
  });

// typically there is no need to monitor request, but you can if you must
  request.on('rendered', (event: RenderRequestEvent<'rendered'>) => {
    console.log('Image Pre-rendered and ready to be used:', event);
  });
});

```

All done! Now you have a complete control over the images loaded by your application.

# LICENSE

MIT

# PS

But thanks to [Oregan Networks](https://oregan.net/) for sponsoring this project.

[![Li](https://badgen.net/badge/Hit%20me%20up%20on/LI?color=blue)](https://www.linkedin.com/in/samvel-avanesov)

Enjoy! 🎉🎉🎉
