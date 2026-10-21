import { BadRequestException } from '@nestjs/common';
import type { AuthenticatedUser } from '../interfaces/authenticated-user.interface';
import { MediaController } from './media.controller';
import type { ImageStorageService } from './image-storage.service';

const USER: AuthenticatedUser = {
  id: 'u1',
  email: 'admin@nexohub.com',
  name: 'Administrador',
  companyId: 'c1',
  role: 'ADMIN',
};

function createController(result = { url: '/media/J-1/products/foto.png', bytes: 4 }) {
  const images = {
    saveUpload: jest.fn(async () => result),
  } as unknown as ImageStorageService;
  return { controller: new MediaController(images), images };
}

describe('MediaController', () => {
  it('guarda el archivo en la carpeta indicada para la empresa activa', async () => {
    const { controller, images } = createController();
    const buffer = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

    await expect(
      controller.upload(
        USER,
        { buffer, size: buffer.length, mimetype: 'image/png', originalname: 'foto.png' },
        'products',
      ),
    ).resolves.toEqual({ url: '/media/J-1/products/foto.png', bytes: 4 });
    expect(images.saveUpload).toHaveBeenCalledWith('c1', 'u1', 'products', buffer);
  });

  it('rechaza la peticion sin archivo', async () => {
    const { controller, images } = createController();
    await expect(controller.upload(USER, undefined, 'logo')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(images.saveUpload).not.toHaveBeenCalled();
  });

  it('rechaza una carpeta fuera de la lista permitida', async () => {
    const { controller, images } = createController();
    const buffer = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    await expect(
      controller.upload(
        USER,
        { buffer, size: buffer.length, mimetype: 'image/png', originalname: 'x.png' },
        '../secret',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(images.saveUpload).not.toHaveBeenCalled();
  });
});
