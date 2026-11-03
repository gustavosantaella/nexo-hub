import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateProductDto } from './create-product.dto';

const BASE = { name: 'Cafe', price: 1 };

/** Valida un producto con la foto indicada (u omitida si no se pasa). */
function validateWithImage(imageUrl?: string) {
  return validate(
    plainToInstance(CreateProductDto, {
      ...BASE,
      ...(imageUrl === undefined ? {} : { imageUrl }),
    }),
  );
}

describe('CreateProductDto - foto opcional', () => {
  it('acepta un producto sin foto', async () => {
    await expect(validateWithImage()).resolves.toHaveLength(0);
  });

  it('acepta la cadena vacia que envia el formulario sin foto', async () => {
    await expect(validateWithImage('')).resolves.toHaveLength(0);
  });

  it('acepta solo espacios en blanco (el servicio los guarda como null)', async () => {
    await expect(validateWithImage('   ')).resolves.toHaveLength(0);
  });

  it('sigue aceptando una URL local valida', async () => {
    await expect(
      validateWithImage('/media/J-40123456-7/products/foto.webp'),
    ).resolves.toHaveLength(0);
  });

  it('rechaza una URL que no es de imagen', async () => {
    const errors = await validateWithImage('no-es-una-url');
    expect(errors).toHaveLength(1);
    expect(errors[0].property).toBe('imageUrl');
    expect(errors[0].constraints).toHaveProperty('matches');
  });
});
