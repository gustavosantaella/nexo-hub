import { isDataImageUrl, isImageUrl, MAX_IMAGE_URL_LENGTH } from './image-url.util';

describe('image-url.util', () => {
  it('acepta rutas locales /media y URLs publicas heredadas', () => {
    expect(isImageUrl('/media/J-1/products/foto.jpg')).toBe(true);
    expect(isImageUrl('  /media/J-1/menu/foto.webp  ')).toBe(true);
    expect(isImageUrl('https://cdn.ejemplo.com/foto.png?size=320')).toBe(true);
  });

  it('rechaza base64 y rutas manipuladas', () => {
    expect(isImageUrl('data:image/png;base64,AAAA')).toBe(false);
    expect(isDataImageUrl('data:image/webp;base64,AAAA')).toBe(true);
    expect(isImageUrl('/media/../../secreto.jpg')).toBe(false);
    expect(isImageUrl('javascript:alert(1)')).toBe(false);
    expect(isImageUrl('')).toBe(false);
  });

  it('limita la longitud de la URL', () => {
    expect(isImageUrl(`/media/${'a'.repeat(MAX_IMAGE_URL_LENGTH)}`)).toBe(false);
  });
});
