import { getImageType, ImageType } from '../image-type';
import { getBmpDimensions } from './bmp-decoder';
import { getGifDimensions } from './gif-decoder';
import { getJpegDimensions } from './jpeg-decoder';
import { getPngDimensions } from './png-decoder';

/**
 * The dimensions of an image.
 */
export type Size = {
  width: number;
  height: number;
};

/**
 * The image data, including the image type, dimensions, and raw data.
 */
export type ImageData = {
  type: ImageType;
  size: Size;
  arrayBuffer: ArrayBuffer;
};
/**
 * Decode the image data from a Blob to get the image type and dimensions.
 */
export async function getImageData(
  arrayBuffer: ArrayBuffer,
): Promise<ImageData> {
  // const arrayBuffer = await blobToArrayBuffer(blob);
  const type = await getImageType(arrayBuffer);
  switch (type) {
    case 'image/png':
      return { arrayBuffer, type, size: await getPngDimensions(arrayBuffer) };
    case 'image/jpeg':
      return { arrayBuffer, type, size: await getJpegDimensions(arrayBuffer) };
    case 'image/bmp':
      return { arrayBuffer, type, size: await getBmpDimensions(arrayBuffer) };
    case 'image/gif':
      return { arrayBuffer, type, size: await getGifDimensions(arrayBuffer) };
    default:
      throw new Error(`Unsupported image type: "${type}"`);
  }
}
