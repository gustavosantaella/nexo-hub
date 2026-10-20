import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { environment } from '../../../environments/environment';
import type { PaginationMeta } from '../../core/models/api.model';
import type { StockLevel } from '../../core/models/operations.model';
import { money, setDisplayCurrency } from '../../core/utils/format';
import { InventoryPage } from './inventory.page';

const API = environment.apiUrl;

const META: PaginationMeta = {
  total: 0,
  page: 1,
  limit: 20,
  totalPages: 0,
  hasNextPage: false,
  hasPreviousPage: false,
};

/** Caja de 24 unidades a $ 24: la unidad suelta se reparte (24 / 24 = $ 1). */
const CAJA: StockLevel = {
  id: 'p-caja',
  sku: 'MALTIN-24',
  name: 'Malta (caja 24)',
  stock: 48,
  minStock: 24,
  unit: 'CAJA',
  unitsPerBox: 24,
  unitPrice: 0,
  cost: 0.5,
  price: 24,
  stockValue: 24,
  isLowStock: false,
  category: { id: 'c1', name: 'Bebidas' },
};

/** Refresco suelto: sin presentación no hay precio unitario que ajustar. */
const SUELTO: StockLevel = {
  id: 'p-suelto',
  sku: 'REFR-01',
  name: 'Refresco',
  stock: 10,
  minStock: 2,
  unit: 'UND',
  unitsPerBox: 1,
  unitPrice: 0,
  cost: 0.4,
  price: 1,
  stockValue: 4,
  isLowStock: false,
};

/**
 * Caja de 24 cargada en bolívares: la presentación a Bs 970,00 y la unidad suelta
 * a Bs 350,00 (970 Bs por dólar). El equivalente contable que se guarda es
 * $ 1,00 y $ 0,36, y ese centavo es el que producía el Bs 349,20 en pantalla.
 */
const CAJA_VES: StockLevel = {
  id: 'p-caja-ves',
  sku: 'MALTIN-24-VES',
  name: 'Malta (caja 24) en bolívares',
  stock: 48,
  minStock: 24,
  unit: 'CAJA',
  unitsPerBox: 24,
  unitPrice: 0.36,
  unitPriceEntered: 350,
  unitPriceCurrency: 'VES',
  unitPriceRateKey: 'BCV_USD',
  cost: 0.5,
  price: 1,
  priceEntered: 970,
  priceCurrency: 'VES',
  priceRateKey: 'BCV_USD',
  stockValue: 24,
  isLowStock: false,
  category: { id: 'c1', name: 'Bebidas' },
};

/** Inventario: niveles de stock y el formulario que los mueve. */
describe('InventoryPage (registrar movimiento)', () => {
  let http: HttpTestingController;

  beforeEach(async () => {
    setDisplayCurrency(null);
    await TestBed.configureTestingModule({
      imports: [InventoryPage],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
      ],
    }).compileComponents();

    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    // La moneda de visualización es estado global de `format.ts`.
    setDisplayCurrency(null);
    http.verify();
  });

  function mount(items: StockLevel[] = [CAJA, SUELTO]): {
    fixture: ComponentFixture<InventoryPage>;
    page: InventoryPage;
  } {
    const fixture = TestBed.createComponent(InventoryPage);
    const page = fixture.componentInstance;
    fixture.detectChanges();

    http
      .expectOne((request) => request.url === `${API}/inventory/stock`)
      .flush(items);
    http
      .expectOne(
        (request) =>
          request.method === 'GET' && request.url === `${API}/inventory/movements`,
      )
      .flush({ items: [], meta: META });
    fixture.detectChanges();

    return { fixture, page };
  }

  /** Respuestas de las recargas que dispara un movimiento guardado. */
  function flushReload(): void {
    http
      .match((request) => request.url === `${API}/inventory/stock`)
      .forEach((request) => request.flush([CAJA, SUELTO]));
    http
      .match(
        (request) =>
          request.method === 'GET' && request.url === `${API}/inventory/movements`,
      )
      .forEach((request) => request.flush({ items: [], meta: META }));
  }

  it('la vista previa del movimiento cuenta la caja como 24 unidades', () => {
    const { page } = mount();

    // El formulario abre en cajas (la unidad del producto) con cantidad 1.
    page.openMovement(CAJA);

    expect(page.movForm.inputUnit).toBe('CAJA');
    expect(page.movementPreview?.text).toBe('Quedará 3 cajas · 72 UND');
  });

  it('avisa cuando una salida en cajas supera el stock disponible', () => {
    const { page } = mount();

    page.openMovement(CAJA);
    page.movForm.type = 'OUT';
    page.movForm.quantity = 3; // 3 cajas = 72 unidades y solo hay 48.

    expect(page.movementAlerts).toEqual([
      'Stock insuficiente: solo hay 2 cajas.',
    ]);
  });

  it('pide el precio unitario solo en las entradas de productos por presentación', () => {
    const { page } = mount();

    page.openMovement(CAJA);
    expect(page.showUnitPrice).toBe(true);
    expect(page.unitPriceReference).toContain('$ 1.00 por unidad suelta');

    page.movForm.type = 'OUT';
    expect(page.showUnitPrice).toBe(false);

    page.openMovement(SUELTO);
    expect(page.showUnitPrice).toBe(false);
  });

  it('envía el precio unitario y su moneda al registrar la entrada', () => {
    const { page } = mount();

    page.openMovement(CAJA);
    page.movForm.unitPrice = 3150;
    page.movForm.unitPriceCurrency = 'VES';
    page.submitMovement();

    const request = http.expectOne(
      (candidate) =>
        candidate.method === 'POST' && candidate.url === `${API}/inventory/movements`,
    );
    expect(request.request.body).toEqual(
      jasmine.objectContaining({
        productId: 'p-caja',
        type: 'IN',
        inputUnit: 'CAJA',
        inputQuantity: 1,
        unitPrice: 3150,
        unitPriceCurrency: 'VES',
      }),
    );
    request.flush({
      movement: { id: 'mv1' },
      stockBefore: 48,
      stockAfter: 72,
    });
    flushReload();
  });

  it('no envía precio unitario cuando el operador lo deja en 0', () => {
    const { page } = mount();

    page.openMovement(CAJA);
    page.submitMovement();

    const request = http.expectOne(
      (candidate) =>
        candidate.method === 'POST' && candidate.url === `${API}/inventory/movements`,
    );
    expect('unitPrice' in (request.request.body as object)).toBe(false);
    request.flush({
      movement: { id: 'mv1' },
      stockBefore: 48,
      stockAfter: 72,
    });
    flushReload();
  });

  it('muestra a cuánto se vende la unidad suelta de una presentación', () => {
    const { fixture, page } = mount();

    expect(page.unitPriceLabel(CAJA)).toBe('$ 1.00 por unidad suelta');
    expect(page.unitPriceLabel(SUELTO)).toBeNull();
    expect(fixture.nativeElement.textContent).toContain(
      'por unidad suelta',
    );
  });

  /**
   * Con la moneda de visualización en bolívares la lista mostraba el equivalente
   * contable del precio unitario redondeado a centavos de dólar: Bs 350,00 a 970
   * Bs por dólar son $ 0,36 y al volver a bolívares daba Bs 349,20.
   */
  it('muestra el precio unitario cargado a mano sin el redondeo en dólares', () => {
    setDisplayCurrency({
      code: 'VES',
      label: 'Bolívares',
      symbol: 'Bs',
      decimals: 2,
      bsPerUnit: 1,
      bsPerUsd: 970,
    });
    const { page } = mount([CAJA_VES]);

    // El monto guardado convertido de vuelta es el que se veía mal.
    expect(money(CAJA_VES.unitPrice)).toBe('Bs 349.20');
    expect(page.unitPriceLabel(CAJA_VES)).toBe('Bs 350.00 por unidad suelta');

    page.openMovement(CAJA_VES);
    expect(page.unitPriceReference).toBe(
      'Actual: Bs 350.00 por unidad suelta · la presentación (24 unidades) se cobra en el catálogo a Bs 970.00',
    );
  });
});
