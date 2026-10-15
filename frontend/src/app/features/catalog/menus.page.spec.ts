import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { environment } from '../../../environments/environment';
import type { Menu, ProductOption } from '../../core/models/api.model';
import type { RatesSnapshot } from '../../core/models/rates.model';
import { RatesService } from '../../core/services/rates.service';
import { setDisplayCurrency } from '../../core/utils/format';
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

/** Menú del listado: precio 20 y costo 10, o sea un margen de 10 (en USD). */
const MARGIN_MENU: Menu = {
  id: 'menu-1',
  code: 'MEN-001',
  name: 'Parrilla mixta',
  description: null,
  imageUrl: null,
  price: 20,
  priceCurrency: 'USD',
  priceRate: null,
  priceEntered: null,
  cost: 10,
  availability: 'ALL',
  preparationMinutes: null,
  categoryId: null,
  active: true,
  createdAt: '2026-10-13T12:00:00.000Z',
  updatedAt: '2026-10-13T12:00:00.000Z',
  category: null,
  ingredients: [],
  margin: 10,
  maxServings: null,
  available: true,
  inactiveIngredients: [],
};

/**
 * Tasas del sistema con la personalizada del local activa (905,42 Bs por dólar):
 * el margen debe mostrar las tres conversiones, no solo las del BCV.
 */
const RATES_WITH_CUSTOM: RatesSnapshot = {
  bcv: {
    current: { date: '2026-10-13', usd: 876.7976, eur: 982.00454402 },
    previous: { date: '2026-10-09', usd: 875.6505, eur: 980.61472543 },
    changePercentage: { usd: 0.131, eur: 0.1417 },
    fetchedAt: '2026-10-13T12:00:00.000Z',
    expiresAt: '2026-10-13T12:15:00.000Z',
    stale: false,
    sourceUrl: 'https://rates.dolarvzla.com/bcv/current.json',
  },
  custom: {
    usd: 905.42,
    updatedAt: '2026-10-13T12:05:00.000Z',
    updatedBy: 'Administrador',
  },
  rates: [
    {
      key: 'BCV_USD',
      currency: 'USD',
      source: 'BCV',
      rate: 876.7976,
      date: '2026-10-13',
      previousRate: 875.6505,
      changePercentage: 0.131,
    },
    {
      key: 'BCV_EUR',
      currency: 'EUR',
      source: 'BCV',
      rate: 982.00454402,
      date: '2026-10-13',
      previousRate: 980.61472543,
      changePercentage: 0.1417,
    },
    {
      key: 'CUSTOM_USD',
      currency: 'USD',
      source: 'CUSTOM',
      rate: 905.42,
      date: null,
      previousRate: null,
      changePercentage: null,
    },
  ],
  activeKey: 'CUSTOM_USD',
  currencies: [
    {
      code: 'USD',
      label: 'Dólares',
      symbol: '$',
      enabled: true,
      bsPerUnit: 905.42,
      source: 'BASE',
      isBase: true,
      isDisplayBase: true,
      bsPerUsd: 905.42,
    },
  ],
  baseCurrency: {
    code: 'USD',
    label: 'Dólares',
    symbol: '$',
    decimals: 2,
    bsPerUnit: 905.42,
    bsPerUsd: 905.42,
  },
  reference: null,
};

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
    // La moneda base es estado global de `format.ts`: se devuelve a dólares.
    setDisplayCurrency(null);
  });

  /**
   * Monta la página y resuelve sus peticiones iniciales. Con `rates` carga antes
   * el snapshot de tasas (como hace el layout al iniciar sesión), para que los
   * montos muestren sus conversiones "al cambio".
   */
  function mount(
    menus: Menu[] = [],
    rates?: RatesSnapshot,
  ): { fixture: ComponentFixture<MenusPage>; page: MenusPage } {
    const fixture = TestBed.createComponent(MenusPage);
    const page = fixture.componentInstance;

    if (rates) {
      const service = TestBed.inject(RatesService);
      service.setConversions(true);
      service.load();
      http.expectOne(`${API}/rates`).flush(rates);
    }

    fixture.detectChanges();

    http
      .expectOne((request) => request.method === 'GET' && request.url === `${API}/menus`)
      .flush({ items: menus, meta: META });
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

  it('permite guardar un menú sin receta (se envía vacía)', () => {
    const { page } = mount();
    page.openCreate();
    page.form.name = 'Agua embotellada';
    page.form.price = 2;

    page.save();

    const request = http.expectOne(
      (candidate) => candidate.method === 'POST' && candidate.url === `${API}/menus`,
    );
    // La receta es opcional: sin ingredientes se envia un arreglo vacio.
    expect(request.request.body.ingredients).toEqual([]);
    request.flush({});
    // Al guardar, la pagina recarga el listado.
    http
      .expectOne((candidate) => candidate.method === 'GET' && candidate.url === `${API}/menus`)
      .flush({ items: [], meta: META });
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
    // La validación corta el guardado antes de tocar el API (no queda "guardando").
    expect(page.saving()).toBeFalse();
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

  it('muestra el margen "al cambio" con cada tasa, incluida la personalizada', () => {
    const { fixture } = mount([MARGIN_MENU], RATES_WITH_CUSTOM);

    // El margen es la única celda del listado que pinta conversiones.
    const cells = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('tbody tr td'),
    ).filter((cell) => cell.querySelector('app-money'));

    expect(cells.length).toBe(1);
    const margin = cells[0].textContent as string;

    // Margen del menú: precio 20 - costo 10 = $ 10, con su equivalente en Bs.
    expect(margin).toContain('$ 10.00');
    // Tasa oficial del dólar y del euro (BCV)…
    expect(margin).toContain('BCV $');
    expect(margin).toContain('Bs 8,767.98');
    expect(margin).toContain('BCV €');
    expect(margin).toContain('Bs 9,820.05');
    // …y la personalizada del local (905,42 Bs por dólar).
    expect(margin).toContain('Personalizada');
    expect(margin).toContain('Bs 9,054.20');
  });

  it('muestra el margen "al cambio" del formulario con la tasa personalizada', () => {
    const { fixture, page } = mount([MARGIN_MENU], RATES_WITH_CUSTOM);
    page.openCreate();
    page.form.price = 12;
    fixture.detectChanges();

    const summary = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('p'),
    ).find((item) => item.textContent?.includes('Margen:'));

    expect(summary).toBeTruthy();
    // Sin receta el margen es el precio: 12 * 905,42 con la personalizada.
    expect(summary?.textContent).toContain('Personalizada');
    expect(summary?.textContent).toContain('Bs 10,865.04');
  });


  it('permite pegar la URL de la imagen en vez de subir un archivo', async () => {
    const { fixture, page } = mount();
    page.openCreate();
    fixture.detectChanges();
    // `NgForm` registra sus controles en un microtask (`addControl`): sin ceder
    // el turno, el input todavia no esta enlazado al modelo.
    await fixture.whenStable();
    fixture.detectChanges();

    const input = (fixture.nativeElement as HTMLElement).querySelector<HTMLInputElement>(
      'input[name="imageUrl"]',
    );
    expect(input).toBeTruthy();

    input!.value = 'https://cdn.ejemplo.com/parrilla.jpg';
    input!.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    expect(page.form.imageUrl).toBe('https://cdn.ejemplo.com/parrilla.jpg');

    page.form.name = 'Parrilla mixta';
    page.form.price = 18;
    page.save();

    const request = http.expectOne(
      (candidate) => candidate.method === 'POST' && candidate.url === `${API}/menus`,
    );
    expect(request.request.body.imageUrl).toBe('https://cdn.ejemplo.com/parrilla.jpg');
    request.flush({});
    // Al guardar, la pagina recarga el listado.
    http
      .expectOne((candidate) => candidate.method === 'GET' && candidate.url === `${API}/menus`)
      .flush({ items: [], meta: META });
  });
});
