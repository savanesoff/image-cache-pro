import { getImageType, ImageType } from './image-type';

describe('getImageType', () => {
  const testCases: [string, ImageType][] = [
    ['89504e47', 'image/png'],
    ['47494638', 'image/gif'],
    ['ffd8ffe0', 'image/jpeg'],
    ['4d4d002a', 'image/tiff'], // Big-endian format
    ['424d', 'image/bmp'],
    // ["524946463839000057454250", "image/webp"], // Shortened to match RIFF format
    // Add more cases as needed
  ];

  testCases.forEach(([header, type]) => {
    it(`should return ${type} for header ${header}`, async () => {
      const matched = header.match(/.{1,2}/g);
      if (matched) {
        const bytes = new Uint8Array(matched.map(byte => parseInt(byte, 16)));
        const blob = new Blob([bytes.buffer.slice(0, bytes.byteLength)]);
        await expect(getImageType(blob)).resolves.toBe(type);
      } else {
        throw new Error('Header does not match expected format');
      }
    });
  });

  it('should reject for unknown image type', async () => {
    const blob = new Blob([new Uint8Array([0, 0, 0, 0]).buffer]);
    await expect(getImageType(blob)).rejects.toEqual('Unknown image type');
  });
});
