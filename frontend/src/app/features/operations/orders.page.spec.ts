import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { environment } from '../../../environments/environment';
import type { PaginationMeta, ProductOption } from '../../core/models/api.model';
import type { Order, OrderItem } from '../../core/models/operations.model';
import { RatesService } from '../../core/services/rates.service';
import { ConfirmService } from '../../shared/services/confirm.service';
import { OrdersPage } from './orders.page';

const API = environment.apiUrl;

const META: PaginationMeta = {
  total: 0,
  page: 1,
  limit: 20,
  totalPages: 0,
  hasNextPage: false,
  hasPreviousPage: false,
};

const PRODUCTS: ProductOption[] = [
  { id: 'p1', sku: 'PIZZA-01', name: 'Pizza Familiar', price: 30, stock: 5, unit: 'UND' },
  { id: 'p2', sku: 'GASEOSA-01', name: 'Gaseosa 1.5L', price: 8, stock: 0, unit: 'UND' },
  { id: 'p3', sku: 'CAFE-01', name: 'Cafe pasado', price: 5, stock: 20, unit: 'UND' },
  { id: 'p4', sku: 'INS-001', name: 'Arroz extra', price: 0, stock: 3, unit: 'KG' },
];

function order(partial: Partial<Order> = {}): Order {
  return {
    id: 'o1',
    code: 'PED-0001',
    type: 'TAKEAWAY',
    status: 'PENDING',
    paymentStatus: 'UNPAID',
    subtotal: 30,
    discount: 0,
    tax: 0,
    total: 30,
    paidAmount: 0,
    createdAt: '2026-10-13T10:00:00.000Z',
    updatedAt: '2026-10-13T10:00:00.000Z',
    ...partial,
  };
}

/** Pruebas del POS del cajero: productos del inventario, stock y cobro inmediato. */
describe('OrdersPage (formulario del cajero)', () => {
  let http: HttpTestingController;
  let rates: RatesService;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [OrdersPage],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    }).compileComponents();

    http = TestBed.inject(HttpTestingController);
    rates = TestBed.inject(RatesService);
  });

  afterEach(() => http.verify());

  function mount(options: { cashOpen?: boolean } = {}): {
    fixture: ComponentFixture<OrdersPage>;
    page: OrdersPage;
  } {
    const fixture = TestBed.createComponent(OrdersPage);
    const page = fixture.componentInstance;
    fixture.detectChanges();

    http.expectOne(`${API}/cash/current`).flush(
      options.cashOpen === false
        ? { session: null, summary: null }
        : {
            session: {
              id: 's1',
              code: 'CAJ-0001',
              status: 'OPEN',
              openingAmount: 100,
              openedAt: '2026-10-13T08:00:00.000Z',
            },
            summary: null,
          },
    );
    http.expectOne(`${API}/orders/active`).flush([]);
    http
      .expectOne((request) => request.method === 'GET' && request.url === `${API}/orders`)
      .flush({ items: [], meta: META });
    fixture.detectChanges();
    return { fixture, page };
  }

  /** Abre el modal de nuevo pedido y resuelve las opciones del catalogo. */
  function openCreate(fixture: ComponentFixture<OrdersPage>, page: OrdersPage): void {
    page.openCreate();
    http.expectOne(`${API}/products/options`).flush(PRODUCTS);
    http.expectOne(`${API}/customers/options`).flush([]);
    fixture.detectChanges();
  }

  /** Pedido con una línea (2 × Pizza Familiar = 60) para probar el detalle. */
  function detailOrderWithItem(partial: Partial<Order> = {}): Order {
    return order({
      items: [
        {
          id: 'i1',
          orderId: 'o1',
          productId: 'p1',
          name: 'Pizza Familiar',
          quantity: 2,
          unitPrice: 30,
          total: 60,
        },
      ],
      subtotal: 60,
      total: 60,
      ...partial,
    });
  }

  /** Abre el detalle del pedido y devuelve su primera línea ya guardada. */
  function openDetailWithItem(
    fixture: ComponentFixture<OrdersPage>,
    page: OrdersPage,
    detail: Order,
  ): OrderItem {
    page.openDetail(detail);
    http.expectOne(`${API}/orders/o1`).flush(detail);
    fixture.detectChanges();
    return (page.detailOrder()?.items ?? [])[0];
  }

  function flushReload(): void {
    http
      .match(`${API}/cash/current`)
      .forEach((request) => request.flush({ session: null, summary: null }));
    http.match(`${API}/orders/active`).forEach((request) => request.flush([]));
    http
      .match((request) => request.method === 'GET' && request.url === `${API}/orders`)
      .forEach((request) => request.flush({ items: [], meta: META }));
  }

  it('la grilla muestra solo productos con stock y filtra por nombre o SKU', () => {
    const { fixture, page } = mount();
    openCreate(fixture, page);

    expect(page.filteredProducts.map((product) => product.sku)).toEqual([
      'INS-001',
      'CAFE-01',
      'PIZZA-01',
    ]);

    page.onlyAvailable = false;
    fixture.detectChanges();
    expect(page.filteredProducts.length).toBe(4);

    page.productSearch = 'gase';
    fixture.detectChanges();
    expect(page.filteredProducts.map((product) => product.id)).toEqual(['p2']);

    page.productSearch = 'PIZZA-01';
    fixture.detectChanges();
    expect(page.filteredProducts.map((product) => product.id)).toEqual(['p1']);
  });

  it('no permite vender un producto sin stock del inventario', () => {
    const { fixture, page } = mount();
    openCreate(fixture, page);

    page.addProduct(PRODUCTS[1]);

    expect(page.lines().length).toBe(0);
    expect(page.formError()).toContain('no tiene stock disponible');
  });

  it('agrega productos del inventario y acumula cantidades repetidas', () => {
    const { fixture, page } = mount();
    openCreate(fixture, page);

    page.addProduct(PRODUCTS[0]);
    page.addProduct(PRODUCTS[0]);
    page.addProduct(PRODUCTS[2]);

    expect(page.lines().length).toBe(2);
    expect(page.lines()[0]).toEqual({
      productId: 'p1',
      name: 'Pizza Familiar',
      unitPrice: 30,
      quantity: 2,
      stock: 5,
    });
    expect(page.subtotal).toBe(65);
  });

  it('normaliza la cantidad escrita a mano y limita al stock disponible', () => {
    const { fixture, page } = mount();
    openCreate(fixture, page);

    page.addProduct(PRODUCTS[0]);
    const line = page.lines()[0];

    line.quantity = 99;
    page.onQuantityChange(line);
    expect(line.quantity).toBe(5);
    expect(page.formError()).toContain('Stock insuficiente');

    line.quantity = 0;
    page.onQuantityChange(line);
    expect(line.quantity).toBe(1);
    expect(page.formError()).toBeNull();
  });

  it('calcula subtotal, IGV, total y el vuelto del cobro en efectivo', () => {
    const { fixture, page } = mount();
    openCreate(fixture, page);

    page.addProduct(PRODUCTS[0]);
    page.form.discount = 5;
    page.setTaxRate(18);

    expect(page.subtotal).toBe(30);
    expect(page.discountAmount).toBe(5);
    expect(page.tax).toBe(4.5);
    expect(page.total).toBe(29.5);

    page.receivedAmount = 0;
    page.setReceived(20);
    expect(page.receivedAmount).toBe(49.5);
    expect(page.change).toBe(20);

    expect(page.createButtonLabel).toBe('Crear y cobrar');
  });

  it('crea el pedido y registra el cobro en una sola acción', () => {
    const { fixture, page } = mount();
    openCreate(fixture, page);

    page.addProduct(PRODUCTS[0]);
    page.chargeMethod = 'CASH';
    page.submitCreate();

    const createRequest = http.expectOne(
      (request) => request.method === 'POST' && request.url === `${API}/orders`,
    );
    expect(createRequest.request.body.items).toEqual([
      { productId: 'p1', quantity: 1, unitPrice: 30 },
    ]);

    createRequest.flush(order({ total: 30 }));

    const payRequest = http.expectOne(`${API}/orders/o1/payments`);
    expect(payRequest.request.body).toEqual({
      amount: 30,
      method: 'CASH',
      currency: 'USD',
    });
    payRequest.flush(order({ total: 30, paymentStatus: 'PAID', status: 'COMPLETED' }));

    expect(page.saving()).toBeFalse();
    expect(page.createOpen()).toBeFalse();

    flushReload();
  });

  it('bloquea el cobro si el efectivo recibido es menor al total', () => {
    const { fixture, page } = mount();
    openCreate(fixture, page);

    page.addProduct(PRODUCTS[0]);
    page.chargeMethod = 'CASH';
    page.receivedAmount = 1;
    page.submitCreate();

    expect(page.formError()).toContain('menor al total a cobrar');
    http.expectNone((request) => request.method === 'POST');
  });

  it('agrega productos a un pedido existente desde el detalle', () => {
    const { fixture, page } = mount();

    page.openAdd(order());
    http.expectOne(`${API}/products/options`).flush(PRODUCTS);
    fixture.detectChanges();

    expect(page.addOpen()).toBeTrue();
    page.addProduct(PRODUCTS[0]);
    page.submitAdd();

    const request = http.expectOne(
      (item) => item.method === 'POST' && item.url === `${API}/orders/o1/items`,
    );
    expect(request.request.body).toEqual({
      items: [{ productId: 'p1', quantity: 1, unitPrice: 30 }],
    });

    request.flush(order({ subtotal: 60, total: 60 }));
    expect(page.saving()).toBeFalse();
    expect(page.addOpen()).toBeFalse();

    flushReload();
  });

  it('no permite agregar productos a pedidos completados o cancelados', () => {
    const { page } = mount();

    expect(page.canAddItems(order({ status: 'PENDING' }))).toBeTrue();
    expect(page.canAddItems(order({ status: 'READY' }))).toBeTrue();
    expect(page.canAddItems(order({ status: 'COMPLETED' }))).toBeFalse();
    expect(page.canAddItems(order({ status: 'CANCELLED' }))).toBeFalse();
  });

  it('corrige la cantidad de una línea del detalle y refresca el pedido', () => {
    const { fixture, page } = mount();
    const detail = detailOrderWithItem();
    const item = openDetailWithItem(fixture, page, detail);

    page.changeItemQuantity(detail, item, 3);

    const request = http.expectOne(
      (candidate) =>
        candidate.method === 'PATCH' &&
        candidate.url === `${API}/orders/o1/items/i1`,
    );
    expect(request.request.body).toEqual({ quantity: 3 });

    request.flush(
      detailOrderWithItem({
        items: [{ ...item, quantity: 3, total: 90 }],
        subtotal: 90,
        total: 90,
      }),
    );

    expect(page.itemBusyId()).toBeNull();
    expect(page.detailOrder()?.total).toBe(90);

    flushReload();
  });

  it('no llama al backend con una cantidad inválida o sin cambios', () => {
    const { fixture, page } = mount();
    const detail = detailOrderWithItem();
    const item = openDetailWithItem(fixture, page, detail);

    page.changeItemQuantity(detail, item, 0);
    page.changeItemQuantity(detail, item, item.quantity);

    http.expectNone(
      (candidate) =>
        candidate.method === 'PATCH' &&
        candidate.url === `${API}/orders/o1/items/i1`,
    );
    expect(page.itemBusyId()).toBeNull();
  });

  it('quita un producto del pedido y devuelve el stock al inventario', async () => {
    const { fixture, page } = mount();
    const confirms = TestBed.inject(ConfirmService);
    spyOn(confirms, 'ask').and.resolveTo(true);

    const detail = detailOrderWithItem();
    const item = openDetailWithItem(fixture, page, detail);

    await page.removeItem(detail, item);

    const request = http.expectOne(
      (candidate) =>
        candidate.method === 'DELETE' &&
        candidate.url === `${API}/orders/o1/items/i1`,
    );
    request.flush(detailOrderWithItem({ items: [], subtotal: 0, total: 0 }));

    expect(page.itemBusyId()).toBeNull();
    expect(page.detailOrder()?.items).toEqual([]);

    flushReload();
  });

  it('no quita el producto si el usuario cancela la confirmación', async () => {
    const { fixture, page } = mount();
    const confirms = TestBed.inject(ConfirmService);
    spyOn(confirms, 'ask').and.resolveTo(false);

    const detail = detailOrderWithItem();
    const item = openDetailWithItem(fixture, page, detail);

    await page.removeItem(detail, item);

    http.expectNone((candidate) => candidate.method === 'DELETE');
    expect(page.itemBusyId()).toBeNull();
  });

  it('bloquea el registro si no se eligio ningun producto', () => {
    const { fixture, page } = mount();

    page.openAdd(order());
    http.expectOne(`${API}/products/options`).flush(PRODUCTS);
    fixture.detectChanges();

    page.submitAdd();

    expect(page.formError()).toContain('al menos un producto');
    http.expectNone(
      (item) => item.method === 'POST' && item.url === `${API}/orders/o1/items`,
    );
  });

  it('bloquea el registro si alguna línea supera el stock disponible', () => {
    const { fixture, page } = mount();
    openCreate(fixture, page);

    page.addProduct(PRODUCTS[0]);
    page.lines()[0].quantity = 40; // simula una edicion no validada del input
    page.submitCreate();

    expect(page.formError()).toContain('mayor al stock disponible');
    http.expectNone((request) => request.method === 'POST');
  });

  it('avisa y bloquea una línea sin precio (insumo del inventario)', () => {
    const { fixture, page } = mount();
    openCreate(fixture, page);

    page.addProduct(PRODUCTS[3]);

    expect(page.lines().length).toBe(1);
    expect(page.formError()).toContain('no tiene precio de venta');

    page.submitCreate();
    expect(page.formError()).toContain('mayor a 0');
    http.expectNone((request) => request.method === 'POST');
  });

  it('sin caja abierta solo crea el pedido y no intenta cobrar', () => {
    const { fixture, page } = mount({ cashOpen: false });
    openCreate(fixture, page);

    expect(page.cashOpen()).toBeFalse();
    expect(page.createButtonLabel).toBe('Crear pedido');

    page.addProduct(PRODUCTS[0]);
    page.submitCreate();

    const createRequest = http.expectOne(
      (request) => request.method === 'POST' && request.url === `${API}/orders`,
    );
    createRequest.flush(order());

    http.expectNone((request) => request.method === 'POST' && request.url.includes('/payments'));
    flushReload();
  });

  it('cobra en bolívares convirtiendo el total del pedido', () => {
    const { fixture, page } = mount();
    openCreate(fixture, page);

    // Se cargan las tasas: BCV 876.7976 Bs/USD con el bolívar habilitado.
    rates.load(true);
    http.expectOne(`${API}/rates?refresh=true`).flush({
      bcv: {
        current: { date: '2026-10-13', usd: 876.7976, eur: 982.00454402 },
        previous: { date: '2026-10-09', usd: 875.6505, eur: 980.61472543 },
        changePercentage: { usd: 0.131, eur: 0.1417 },
        fetchedAt: '2026-10-13T12:00:00.000Z',
        expiresAt: '2026-10-13T12:15:00.000Z',
        stale: false,
        sourceUrl: 'https://rates.dolarvzla.com/bcv/current.json',
      },
      custom: null,
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
      ],
      activeKey: 'BCV_USD',
      currencies: [
        {
          code: 'USD',
          label: 'Dólares',
          symbol: '$',
          enabled: true,
          bsPerUnit: 876.7976,
          source: 'BASE',
          isBase: true,
          bsPerUsd: 876.7976,
        },
        {
          code: 'VES',
          label: 'Bolívares',
          symbol: 'Bs',
          enabled: true,
          bsPerUnit: 1,
          source: 'BASE',
          isBase: false,
          bsPerUsd: 876.7976,
        },
      ],
    });
    fixture.detectChanges();

    page.addProduct(PRODUCTS[0]);
    page.onChargeCurrencyChange('VES');
    expect(page.chargeTotal).toBe(26303.93); // 30 USD * 876.7976

    page.submitCreate();

    const createRequest = http.expectOne(
      (request) => request.method === 'POST' && request.url === `${API}/orders`,
    );
    createRequest.flush(order({ total: 30 }));

    const payRequest = http.expectOne(`${API}/orders/o1/payments`);
    expect(payRequest.request.body).toEqual({
      amount: 26303.93,
      method: 'CASH',
      currency: 'VES',
    });
    payRequest.flush(order({ total: 30, paymentStatus: 'PAID' }));

    flushReload();
  });

  it('reabre el cobro si el pago falla despues de crear la venta', () => {
    const { fixture, page } = mount();
    openCreate(fixture, page);

    page.addProduct(PRODUCTS[0]);
    page.submitCreate();

    const createRequest = http.expectOne(
      (request) => request.method === 'POST' && request.url === `${API}/orders`,
    );
    createRequest.flush(order({ total: 30 }));

    http
      .expectOne(`${API}/orders/o1/payments`)
      .flush({ message: 'No hay una caja abierta' }, { status: 400, statusText: 'Bad Request' });

    expect(page.createOpen()).toBeFalse();
    expect(page.payOpen()).toBeTrue();
    expect(page.payForm.amount).toBe(30);

    flushReload();
  });
});
