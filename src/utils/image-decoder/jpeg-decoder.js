/**
 * Get the dimensions of a JPEG image.
 */
export async function getJpegDimensions(arrayBuffer) {
    const dataView = new DataView(arrayBuffer);
    let offset = 2; // Skip the initial 0xFFD8 marker
    while (offset < dataView.byteLength) {
        const marker = dataView.getUint16(offset, false);
        offset += 2;
        if (marker === 0xffc0 || marker === 0xffc2) {
            // SOF0 or SOF2 marker
            const height = dataView.getUint16(offset + 3, false);
            const width = dataView.getUint16(offset + 5, false);
            return { width, height };
        }
        offset += dataView.getUint16(offset, false);
    }
    throw new Error('Invalid JPEG file');
}
