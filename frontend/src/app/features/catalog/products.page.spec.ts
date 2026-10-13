import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { environment } from '../../../environments/environment';
import type { PaginationMeta, Product } from '../../core/models/api.model';
import { ProductsPage } from './products.page';

const API = environment.apiUrl;

const META: PaginationMeta = {
  total: 1,
  page: 1,
  limit: 20,
  totalPages: 1,
  hasNextPage: false,
  hasPreviousPage: false,
};

/** Producto de prueba: precio y costo en la moneda base del sistema (USD). */
function product(overrides: Partial<Product> = {}): Product {
  return {
    id: 'p1',
    sku: 'BEB-001',
    name: 'Inca Kola 500 ml',
    description: null,
    price: 1.5,
    cost: 1,
    stock: 10,
    minStock: 2,
    unit: 'UND',
    trackStock: true,
    active: true,
    categoryId: null,
    supplierId: null,
    createdAt: '2026-10-13T12:00:00.000Z',
    updatedAt: '2026-10-13T12:00:00.000Z',
    ...overrides,
  };
}

describe('ProductsPage', () => {
  let http: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ProductsPage],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
      ],
    }).compileComponents();

    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  /** Monta la pagina con el catalogo y los selects ya resueltos. */
  function mount(items: Product[] = [product()]) {
    const fixture = TestBed.createComponent(ProductsPage);
    fixture.detectChanges();

    http
      .expectOne((request) => request.url === `${API}/products`)
      .flush({ items, meta: { ...META, total: items.length } });
    http.expectOne(`${API}/categories/options`).flush([]);
    http.expectOne(`${API}/suppliers/options`).flush([]);
    fixture.detectChanges();

    return fixture;
  }

  /** Texto visible de la etiqueta del formulario. */
  function labelText(root: HTMLElement, id: string): string {
    const label = root.querySelector(`label[for="${id}"]`) as HTMLLabelElement | null;
    if (!label) throw new Error(`No se encontro la etiqueta ${id}`);
    return (label.textContent ?? '').replace(/\s+/g, ' ').trim();
  }

  it('etiqueta el precio y el costo en la moneda base (USD), no en soles', () => {
    const fixture = mount();
    const page = fixture.componentInstance;

    page.openCreate();
    fixture.detectChanges();

    expect(page.baseCurrency.code).toBe('USD');
    expect(labelText(fixture.nativeElement, 'prod-price')).toBe('Precio (USD) *');
    expect(labelText(fixture.nativeElement, 'prod-cost')).toBe('Costo (USD)');
    expect(fixture.nativeElement.textContent).not.toContain('PEN');
  });

  it('mantiene la moneda base al editar un producto', () => {
    const item = product({ price: 12.5, cost: 8 });
    const fixture = mount([item]);
    const page = fixture.componentInstance;

    page.openEdit(item);
    fixture.detectChanges();

    expect(page.form.price).toBe(12.5);
    expect(page.form.cost).toBe(8);
    expect(labelText(fixture.nativeElement, 'prod-price')).toBe('Precio (USD) *');
    expect(labelText(fixture.nativeElement, 'prod-cost')).toBe('Costo (USD)');
  });
});
