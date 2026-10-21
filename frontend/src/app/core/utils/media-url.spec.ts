import { resolveMediaUrl } from './media-url';

/** Pruebas de la resolucion de URLs locales `/media` con la base del entorno. */
describe('resolveMediaUrl', () => {
  it('antepone la base a las rutas locales de media', () => {
    expect(resolveMediaUrl('/media/J-1/products/foto.jpg', 'http://localhost:3000/media')).toBe(
      'http://localhost:3000/media/J-1/products/foto.jpg',
    );
    expect(resolveMediaUrl('/media/J-1/logo/logo.png', 'https://nexo.test/media/')).toBe(
      'https://nexo.test/media/J-1/logo/logo.png',
    );
  });

  it('deja intactas las URLs absolutas y las rutas que no son de media', () => {
    expect(resolveMediaUrl('https://cdn.test/foto.jpg', 'http://localhost:3000/media')).toBe(
      'https://cdn.test/foto.jpg',
    );
    expect(resolveMediaUrl('data:image/png;base64,AAAA', 'http://localhost:3000/media')).toBe(
      'data:image/png;base64,AAAA',
    );
    expect(resolveMediaUrl('blob:http://localhost/123', 'http://localhost:3000/media')).toBe(
      'blob:http://localhost/123',
    );
    expect(resolveMediaUrl('/api/media/telegram/qr', 'http://localhost:3000/media')).toBe(
      '/api/media/telegram/qr',
    );
    expect(resolveMediaUrl('/assets/logo.svg', 'http://localhost:3000/media')).toBe(
      '/assets/logo.svg',
    );
  });

  it('devuelve una cadena vacia cuando no hay imagen', () => {
    expect(resolveMediaUrl(null)).toBe('');
    expect(resolveMediaUrl(undefined)).toBe('');
    expect(resolveMediaUrl('   ')).toBe('');
  });

  it('mantiene la ruta local si la base esta vacia', () => {
    expect(resolveMediaUrl('/media/J-1/products/foto.jpg', '')).toBe(
      '/media/J-1/products/foto.jpg',
    );
  });
});
