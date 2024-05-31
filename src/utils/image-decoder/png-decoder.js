/**
 * Get the dimensions of a PNG image.
 */
export async function getPngDimensions(arrayBuffer) {
    const dataView = new DataView(arrayBuffer);
    if (dataView.getUint32(0) !== 0x89504e47 ||
        dataView.getUint32(4) !== 0x0d0a1a0a) {
        throw new Error('Invalid PNG file');
    }
    const width = dataView.getUint32(16, false);
    const height = dataView.getUint32(20, false);
    return { width, height };
}
