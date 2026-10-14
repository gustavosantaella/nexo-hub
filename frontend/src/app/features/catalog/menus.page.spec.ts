import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { environment } from '../../../environments/environment';
import type { ProductOption } from '../../core/models/api.model';
import { MenusPage } from './menus.page';

const API = environment.apiUrl;
const META = {
  total: 0,
  page: 1,
  limit: 20,
  totalPages: 0,
  hasNextPage: false,
  hasPreviousPage: false,
};

/** Productos de la empresa: carne por kilo, pan y un postre. */
const PRODUCTS: ProductOption[] = [
  { id: 'carne', sku: 'CAR-001', name: 'Carne', price: 0, cost: 10, stock: 1, unit: 'KG', unitsPerBox: 1 },
  { id: 'pan', sku: 'PAN-001', name: 'Pan', price: 1, cost: 0.5, stock: 40, unit: 'UND', unitsPerBox: 1 },
  { id: 'postre', sku: 'POS-001', name: 'Postre', price: 6, cost: 2, stock: 10, unit: 'UND', unitsPerBox: 1 },
];

/**
 * Formulario de menús: costeo de la receta, disponibilidad y validaciones antes
 * de guardar. La matemática de la receta es la misma que aplica el backend.
 */
describe('MenusPage (receta y costos)', () => {
  let http: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MenusPage],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();

    http = TestBed.inject(HttpTestingController);
    localStorage.clear();
  });

  afterEach(() => {
    http.verify();
    localStorage.clear();
  });

  function mount(): { fixture: ComponentFixture<MenusPage>; page: MenusPage } {
    const fixture = TestBed.createComponent(MenusPage);
    const page = fixture.componentInstance;
    fixture.detectChanges();

    http
      .expectOne((request) => request.method === 'GET' && request.url === `${API}/menus`)
      .flush({ items: [], meta: META });
    http
      .expectOne((request) => request.method === 'GET' && request.url === `${API}/menu-categories`)
      .flush({ items: [], meta: META });
    http.expectOne(`${API}/products/options`).flush(PRODUCTS);
    fixture.detectChanges();

    return { fixture, page };
  }

  it('costea la receta con el costo de cada producto x su cantidad', () => {
    const { page } = mount();
    page.openCreate();

    // 0.5 kg de carne (10/kg) + 2 panes (0.5) = 6.00
    page.form.price = 18;
    page.form.ingredients = [
      { productId: 'carne', quantity: 0.5, section: 'Principal', note: '' },
      { productId: 'pan', quantity: 2, section: 'Acompanamiento', note: '' },
    ];

    expect(page.lineCost(page.form.ingredients[0])).toBe(5);
    expect(page.recipeCost()).toBe(6);
    expect(page.margin()).toBe(12);
  });

  it('calcula para cuantas porciones alcanza el inventario', () => {
    const { page } = mount();
    page.openCreate();
    page.form.ingredients = [
      // 1 kg de carne con 0.1 por porcion: 10; 40 panes con 3: 13 → manda el minimo.
      { productId: 'carne', quantity: 0.1, section: 'Principal', note: '' },
      { productId: 'pan', quantity: 3, section: 'Acompanamiento', note: '' },
    ];

    expect(page.servingsFor(page.form.ingredients[0])).toBe(10);
    expect(page.recipeServings()).toBe(10);

    // Sin productos controlados en la receta no hay tope de porciones.
    page.form.ingredients = [];
    expect(page.recipeServings()).toBeNull();
  });

  it('no guarda un menú sin ingredientes', () => {
    const { page } = mount();
    page.openCreate();
    page.form.name = 'Parrilla';
    page.form.price = 18;

    page.save();

    http.expectNone((request) => request.method === 'POST');
  });

  it('no guarda una receta con el mismo producto repetido', () => {
    const { page } = mount();
    page.openCreate();
    page.form.name = 'Parrilla';
    page.form.price = 18;
    page.form.ingredients = [
      { productId: 'carne', quantity: 1, section: 'Principal', note: '' },
      { productId: 'carne', quantity: 2, section: 'Principal', note: '' },
    ];

    page.save();

    http.expectNone((request) => request.method === 'POST');
  });

  it('envia la receta completa al crear el menú', () => {
    const { page } = mount();
    page.openCreate();
    page.form.name = 'Parrilla mixta';
    page.form.price = 18;
    page.form.categoryId = '';
    page.form.ingredients = [
      { productId: 'carne', quantity: 0.5, section: 'Principal', note: 'al punto' },
      { productId: 'postre', quantity: 1, section: 'Postre', note: '' },
    ];

    page.save();

    const request = http.expectOne(
      (candidate) => candidate.method === 'POST' && candidate.url === `${API}/menus`,
    );
    expect(request.request.body).toEqual({
      code: undefined,
      name: 'Parrilla mixta',
      description: undefined,
      imageUrl: undefined,
      price: 18,
      priceCurrency: 'USD',
      availability: 'ALL',
      preparationMinutes: undefined,
      categoryId: null,
      active: true,
      ingredients: [
        { productId: 'carne', quantity: 0.5, section: 'Principal', note: 'al punto', sortOrder: 0 },
        { productId: 'postre', quantity: 1, section: 'Postre', note: undefined, sortOrder: 1 },
      ],
    });
    request.flush({});
    // Al guardar, la pagina recarga el listado.
    http
      .expectOne((candidate) => candidate.method === 'GET' && candidate.url === `${API}/menus`)
      .flush({ items: [], meta: META });
  });
});
