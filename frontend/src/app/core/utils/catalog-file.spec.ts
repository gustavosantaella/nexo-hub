import {
  catalogFileName,
  catalogFileOverview,
  catalogSum,
  downloadJson,
  readJsonFile,
} from './catalog-file';

/** Pruebas del respaldo del catálogo (Configuración → Datos). */
describe('catalogFileName (respaldo del catálogo)', () => {
  it('usa la fecha de exportación en formato ISO (solo el día)', () => {
    expect(catalogFileName('2026-10-15T13:45:12.000Z')).toBe('nexo-hub-catalogo-2026-10-15.json');
    expect(catalogFileName(new Date('2026-01-02T00:00:00.000Z'))).toBe(
      'nexo-hub-catalogo-2026-01-02.json',
    );
  });

  it('cae en la fecha de hoy cuando la fecha no es válida', () => {
    const today = new Date().toISOString().slice(0, 10);
    expect(catalogFileName('no es una fecha')).toBe(`nexo-hub-catalogo-${today}.json`);
  });
});

describe('downloadJson (descarga del archivo)', () => {
  it('descarga el documento con el nombre indicado y libera la URL', () => {
    const createUrl = spyOn(URL, 'createObjectURL').and.returnValue('blob:respaldo');
    const revokeUrl = spyOn(URL, 'revokeObjectURL');
    const clicks: HTMLAnchorElement[] = [];
    spyOn(HTMLAnchorElement.prototype, 'click').and.callFake(function (this: HTMLAnchorElement) {
      clicks.push(this);
    });

    downloadJson('nexo-hub-catalogo-2026-10-15.json', { format: 'nexo-hub.catalog' });

    expect(createUrl).toHaveBeenCalled();
    expect(clicks.length).toBe(1);
    expect(clicks[0].download).toBe('nexo-hub-catalogo-2026-10-15.json');
    expect(clicks[0].getAttribute('href')).toBe('blob:respaldo');
    expect(revokeUrl).toHaveBeenCalledWith('blob:respaldo');
    // El enlace no queda montado: no se deja basura en la pantalla.
    expect(document.querySelector('a[download]')).toBeNull();
  });

  it('escribe el documento como JSON (lo que después se vuelve a importar)', async () => {
    const blobs: Blob[] = [];
    spyOn(URL, 'createObjectURL').and.callFake((value: Blob | MediaSource) => {
      blobs.push(value as Blob);
      return 'blob:respaldo';
    });
    spyOn(URL, 'revokeObjectURL');
    spyOn(HTMLAnchorElement.prototype, 'click');

    const document_ = {
      format: 'nexo-hub.catalog',
      version: 1,
      counts: { categories: 1, menuCategories: 0, suppliers: 0, products: 2, menus: 0 },
    };
    downloadJson('respaldo.json', document_);

    expect(blobs.length).toBe(1);
    expect(blobs[0].type).toBe('application/json');
    expect(JSON.parse(await blobs[0].text())).toEqual(document_);
  });
});

describe('readJsonFile (archivo elegido por el usuario)', () => {
  it('devuelve el contenido del archivo elegido', async () => {
    const file = new File(['{"format":"nexo-hub.catalog","version":1}'], 'respaldo.json', {
      type: 'application/json',
    });
    expect(await readJsonFile(file)).toEqual({ format: 'nexo-hub.catalog', version: 1 });
  });

  it('avisa cuando el archivo no es JSON', async () => {
    const file = new File(['no soy un respaldo'], 'foto.png', { type: 'image/png' });
    await expectAsync(readJsonFile(file)).toBeRejectedWithError(
      /El archivo no es un JSON válido/,
    );
  });

  it('avisa cuando el archivo está vacío', async () => {
    const file = new File(['   '], 'vacio.json', { type: 'application/json' });
    await expectAsync(readJsonFile(file)).toBeRejectedWithError(/El archivo está vacío/);
  });
});

describe('catalogSum (conteos por entidad)', () => {
  it('suma los conteos de las cinco entidades', () => {
    expect(
      catalogSum({ categories: 3, menuCategories: 2, suppliers: 1, products: 10, menus: 4 }),
    ).toBe(20);
  });

  it('devuelve 0 con un archivo sin registros', () => {
    expect(
      catalogSum({ categories: 0, menuCategories: 0, suppliers: 0, products: 0, menus: 0 }),
    ).toBe(0);
  });

  it('ignora las entidades que no vengan en el conteo', () => {
    const parcial = { categories: 2, menus: 3 } as Record<
      'categories' | 'menuCategories' | 'suppliers' | 'products' | 'menus',
      number
    >;
    expect(catalogSum(parcial)).toBe(5);
  });
});

describe('catalogFileOverview (lo que trae el archivo elegido)', () => {
  /** Respaldo mínimo pero completo, como el que escribe el API. */
  const respaldo = {
    format: 'nexo-hub.catalog',
    version: 1,
    exportedAt: '2026-10-15T13:45:12.000Z',
    company: { id: 'company-1', name: 'Bodega Central' },
    counts: { categories: 1, menuCategories: 1, suppliers: 1, products: 2, menus: 1 },
    categories: [{ name: 'Bebidas' }],
    menuCategories: [{ name: 'Almuerzos' }],
    suppliers: [{ name: 'Distribuidora' }],
    products: [{ sku: 'A-1' }, { sku: 'A-2' }],
    menus: [{ code: 'M-1' }],
  };

  it('cuenta los registros del archivo, resume la empresa y el total', () => {
    const overview = catalogFileOverview(respaldo);

    expect(overview.companyName).toBe('Bodega Central');
    expect(overview.exportedAt).toBe('2026-10-15T13:45:12.000Z');
    expect(overview.counts.categories).toBe(1);
    expect(overview.counts.menuCategories).toBe(1);
    expect(overview.counts.suppliers).toBe(1);
    expect(overview.counts.products).toBe(2);
    expect(overview.counts.menus).toBe(1);
    expect(overview.total).toBe(6);
  });

  it('cuenta las listas del archivo y no el resumen que traiga', () => {
    const desactualizado = { ...respaldo, counts: { products: 99 } };

    const overview = catalogFileOverview(desactualizado);

    expect(overview.counts.products).toBe(2);
    expect(overview.total).toBe(6);
  });

  it('acepta un archivo sin listas (respaldo vacío)', () => {
    const overview = catalogFileOverview({
      format: 'nexo-hub.catalog',
      version: 1,
      company: { id: 'company-1', name: '' },
      exportedAt: '2026-10-15T13:45:12.000Z',
    });

    expect(overview.total).toBe(0);
    // Sin nombre de empresa se muestra un texto genérico, no un hueco.
    expect(overview.companyName).toBe('otra empresa');
  });

  it('rechaza un JSON que no es un respaldo del catálogo', () => {
    expect(() => catalogFileOverview({ hola: 'mundo' })).toThrowError(/no es un respaldo/);
    expect(() => catalogFileOverview('texto')).toThrowError(/no es un respaldo/);
    expect(() => catalogFileOverview(null)).toThrowError(/no es un respaldo/);
  });

  it('rechaza un archivo exportado por una versión más nueva', () => {
    expect(() => catalogFileOverview({ ...respaldo, version: 2 })).toThrowError(
      /versión más nueva/,
    );
  });

  it('acepta un archivo de una versión anterior', () => {
    const overview = catalogFileOverview({ ...respaldo, version: 0 });

    expect(overview.total).toBe(6);
  });
});
