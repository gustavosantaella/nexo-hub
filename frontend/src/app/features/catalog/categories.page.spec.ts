import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { environment } from '../../../environments/environment';
import type { Category, PaginationMeta } from '../../core/models/api.model';
import { ConfirmService } from '../../shared/services/confirm.service';
import { CategoriesPage } from './categories.page';

const API = environment.apiUrl;

const META: PaginationMeta = {
  total: 1,
  page: 1,
  limit: 20,
  totalPages: 1,
  hasNextPage: false,
  hasPreviousPage: false,
};

/** Categoria de prueba: por defecto una principal sin subcategorias. */
function category(overrides: Partial<Category> = {}): Category {
  return {
    id: 'cat-bebidas',
    name: 'Bebidas',
    description: null,
    parentId: null,
    parent: null,
    active: true,
    createdAt: '2026-10-13T12:00:00.000Z',
    updatedAt: '2026-10-13T12:00:00.000Z',
    _count: { products: 0, subcategories: 0 },
    ...overrides,
  };
}

/** Texto normalizado de las celdas de una fila del listado. */
function cells(row: HTMLTableRowElement): string[] {
  return Array.from(row.querySelectorAll('td')).map((cell) =>
    (cell.textContent ?? '').replace(/\s+/g, ' ').trim(),
  );
}

describe('CategoriesPage (subcategorias)', () => {
  let http: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CategoriesPage],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
      ],
    }).compileComponents();

    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  /** Monta la pagina resolviendo el listado y el select de categorias. */
  function mount(items: Category[] = [category()], options: Category[] = items) {
    const fixture = TestBed.createComponent(CategoriesPage);
    fixture.detectChanges();

    http
      .expectOne((request) => request.url === `${API}/categories`)
      .flush({ items, meta: { ...META, total: items.length } });
    http.expectOne(`${API}/categories/options`).flush(options);
    fixture.detectChanges();

    return fixture;
  }

  /** Recarga del listado y del select que hace la pagina despues de guardar. */
  function expectReload(items: Category[] = [category()]): void {
    http
      .expectOne((request) => request.url === `${API}/categories`)
      .flush({ items, meta: { ...META, total: items.length } });
    http.expectOne(`${API}/categories/options`).flush(items);
  }

  it('muestra la categoria principal de cada subcategoria', () => {
    const parent = category({ _count: { products: 3, subcategories: 1 } });
    const child = category({
      id: 'cat-refrescos',
      name: 'Refrescos',
      parentId: 'cat-bebidas',
      parent: { id: 'cat-bebidas', name: 'Bebidas' },
    });
    const fixture = mount([parent, child], [parent, child]);
    const rows = fixture.nativeElement.querySelectorAll(
      'tbody tr',
    ) as NodeListOf<HTMLTableRowElement>;

    expect(cells(rows[0])[1]).toBe('Principal');
    expect(cells(rows[0])[4]).toBe('1');
    expect(cells(rows[1])[0]).toContain('↳');
    expect(cells(rows[1])[1]).toBe('Bebidas');
  });

  it('solo ofrece las principales como categoria principal (ni ella misma)', () => {
    const parent = category({ _count: { products: 0, subcategories: 1 } });
    const child = category({
      id: 'cat-refrescos',
      name: 'Refrescos',
      parentId: 'cat-bebidas',
      parent: { id: 'cat-bebidas', name: 'Bebidas' },
    });
    const page = mount([parent, child], [parent, child]).componentInstance;

    // Al editar una subcategoria solo se puede elegir entre principales.
    page.openEdit(child);
    expect(page.parentOptions().map((option) => option.id)).toEqual([
      'cat-bebidas',
    ]);
    expect(page.hasSubcategories()).toBe(false);

    // Una categoria con hijas no puede ser subcategoria de otra.
    page.openEdit(parent);
    expect(page.parentOptions()).toEqual([]);
    expect(page.hasSubcategories()).toBe(true);
  });

  it('crea la subcategoria con la principal ya elegida', () => {
    const parent = category({ _count: { products: 0, subcategories: 1 } });
    const fixture = mount([parent]);
    const page = fixture.componentInstance;

    page.openCreateSub(parent);
    fixture.detectChanges();
    expect(page.form.parentId).toBe('cat-bebidas');

    page.form.name = 'Refrescos';
    page.save();

    const request = http.expectOne(
      (candidate) =>
        candidate.method === 'POST' && candidate.url === `${API}/categories`,
    );
    expect(request.request.body).toEqual(
      jasmine.objectContaining({ name: 'Refrescos', parentId: 'cat-bebidas' }),
    );
    request.flush(category({ id: 'cat-refrescos', name: 'Refrescos' }));
    expectReload([parent]);
  });

  it('filtra las subcategorias de una principal al pulsar su conteo', () => {
    const parent = category({ _count: { products: 0, subcategories: 2 } });
    const fixture = mount([parent]);
    const page = fixture.componentInstance;

    page.filterByParent(parent);

    const request = http.expectOne(
      (candidate) => candidate.url === `${API}/categories`,
    );
    expect(request.request.params.get('parentId')).toBe('cat-bebidas');
    request.flush({ items: [], meta: { ...META, total: 0 } });
    fixture.detectChanges();

    expect(
      (fixture.nativeElement.textContent ?? '').replace(/\s+/g, ' '),
    ).toContain('Subcategorías de Bebidas');
  });

  it('avisa en la confirmacion que las subcategorias quedan como principales', async () => {
    const parent = category({ _count: { products: 0, subcategories: 2 } });
    const fixture = mount([parent]);
    const confirm = TestBed.inject(ConfirmService);
    const ask = spyOn(confirm, 'ask').and.resolveTo(false);

    await fixture.componentInstance.remove(parent);

    expect(ask.calls.mostRecent().args[0].message).toContain(
      'Sus 2 subcategorías quedarán como categorías principales.',
    );
  });
});
