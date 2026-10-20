import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { environment } from '../../../environments/environment';
import type { PaginationMeta, ProductOption } from '../../core/models/api.model';
import type { Order, OrderItem } from '../../core/models/operations.model';
import type { RatesSnapshot } from '../../core/models/rates.model';
import { PreferencesService } from '../../core/services/preferences.service';
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
  {
    id: 'p1',
    sku: 'PIZZA-01',
    name: 'Pizza Familiar',
    price: 30,
    stock: 5,
    unit: 'UND',
    unitsPerBox: 1,
  },
  {
    id: 'p2',
    sku: 'GASEOSA-01',
    name: 'Gaseosa 1.5L',
    price: 8,
    stock: 0,
    unit: 'UND',
    unitsPerBox: 1,
  },
  {
    id: 'p3',
    sku: 'CAFE-01',
    name: 'Cafe pasado',
    price: 5,
    stock: 20,
    unit: 'UND',
    unitsPerBox: 1,
  },
  {
    id: 'p4',
    sku: 'INS-001',
    name: 'Arroz extra',
    price: 0,
    stock: 3,
    unit: 'KG',
    unitsPerBox: 1,
  },
  /** Caja de 24 unidades a $ 24: la unidad suelta se vende a $ 1. */
  {
    id: 'p5',
    sku: 'MALTIN-24',
    name: 'Malta (caja 24)',
    price: 24,
    stock: 50,
    unit: 'CAJA',
    unitsPerBox: 24,
  },
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
    tip: 0,
    deliveryFee: 0,
    total: 30,
    paidAmount: 0,
    createdAt: '2026-10-13T10:00:00.000Z',
    updatedAt: '2026-10-13T10:00:00.000Z',
    ...partial,
  };
}

/**
 * Tasas del sistema para el desglose de los dialogos: BCV dolar (900), BCV euro
 * (1000) y la personalizada del local (950).
 */
const RATES_SNAPSHOT: RatesSnapshot = {
  bcv: {
    current: { date: '2026-10-13', usd: 900, eur: 1000 },
    previous: { date: '2026-10-09', usd: 890, eur: 990 },
    changePercentage: { usd: 1.12, eur: 1.01 },
    fetchedAt: '2026-10-13T12:00:00.000Z',
    expiresAt: '2026-10-13T12:15:00.000Z',
    stale: false,
    sourceUrl: 'https://rates.dolarvzla.com/bcv/current.json',
  },
  custom: { usd: 950, updatedAt: '2026-10-13T12:00:00.000Z', updatedBy: null },
  rates: [
    {
      key: 'BCV_USD',
      currency: 'USD',
      source: 'BCV',
      rate: 900,
      date: '2026-10-13',
      previousRate: 890,
      changePercentage: 1.12,
    },
    {
      key: 'BCV_EUR',
      currency: 'EUR',
      source: 'BCV',
      rate: 1000,
      date: '2026-10-13',
      previousRate: 990,
      changePercentage: 1.01,
    },
    {
      key: 'CUSTOM_USD',
      currency: 'USD',
      source: 'CUSTOM',
      rate: 950,
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
      bsPerUnit: 950,
      source: 'CUSTOM',
      isBase: true,
      isDisplayBase: true,
      bsPerUsd: 950,
    },
    {
      code: 'VES',
      label: 'Bolívares',
      symbol: 'Bs',
      enabled: true,
      bsPerUnit: 1,
      source: 'BASE',
      isBase: false,
      isDisplayBase: false,
      bsPerUsd: 950,
    },
  ],
  baseCurrency: {
    code: 'USD',
    label: 'Dólares',
    symbol: '$',
    decimals: 2,
    bsPerUnit: 950,
    bsPerUsd: 950,
  },
  reference: null,
};

/**
 * Tasas de la venta de mostrador con los precios vistos en BOLÍVARES: la tasa
 * personalizada del local (950) es la activa —por eso cada $ 10 se leen como
 * Bs 9.500— y el BCV marca 876,7976 Bs por dólar, que es con lo que cobra el
 * cajero cuando la empresa fija el BCV como tasa de cobro.
 */
const POS_RATES: RatesSnapshot = {
  bcv: {
    current: { date: '2026-10-13', usd: 876.7976, eur: 982.00454402 },
    previous: { date: '2026-10-09', usd: 875.6505, eur: 980.61472543 },
    changePercentage: { usd: 0.131, eur: 0.1417 },
    fetchedAt: '2026-10-13T12:00:00.000Z',
    expiresAt: '2026-10-13T12:15:00.000Z',
    stale: false,
    sourceUrl: 'https://rates.dolarvzla.com/bcv/current.json',
  },
  custom: { usd: 950, updatedAt: '2026-10-13T12:00:00.000Z', updatedBy: null },
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
      key: 'CUSTOM_USD',
      currency: 'USD',
      source: 'CUSTOM',
      rate: 950,
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
      bsPerUnit: 950,
      source: 'CUSTOM',
      isBase: true,
      isDisplayBase: false,
      bsPerUsd: 950,
    },
    {
      code: 'VES',
      label: 'Bolívares',
      symbol: 'Bs',
      enabled: true,
      bsPerUnit: 1,
      source: 'BASE',
      isBase: false,
      isDisplayBase: true,
      bsPerUsd: 950,
    },
  ],
  baseCurrency: {
    code: 'VES',
    label: 'Bolívares',
    symbol: 'Bs',
    decimals: 2,
    bsPerUnit: 1,
    bsPerUsd: 950,
  },
  reference: null,
};

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

  afterEach(() => {
    http.verify();
    // La preferencia vive en `localStorage`: se limpia para no pasarla de una prueba a otra.
    localStorage.clear();
  });

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
    http.expectOne(`${API}/menus/options`).flush([]);
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
      'MALTIN-24',
      'PIZZA-01',
    ]);

    page.onlyAvailable = false;
    fixture.detectChanges();
    expect(page.filteredProducts.length).toBe(5);

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
      menuId: null,
      name: 'Pizza Familiar',
      unitPrice: 30,
      quantity: 2,
      stock: 5,
      unit: 'UND',
      unitsPerBox: 1,
    });
    expect(page.subtotal).toBe(65);
  });

  it('vende la unidad suelta de un producto por caja al precio de la caja repartido', () => {
    const { fixture, page } = mount();
    openCreate(fixture, page);

    page.addProduct(PRODUCTS[4]);

    expect(page.lines()).toEqual([
      {
        productId: 'p5',
        menuId: null,
        name: 'Malta (caja 24)',
        unitPrice: 1,
        quantity: 1,
        stock: 50,
        unit: 'CAJA',
        unitsPerBox: 24,
      },
    ]);
    expect(page.subtotal).toBe(1);
  });

  it('agrega una caja completa como sus unidades individuales', () => {
    const { fixture, page } = mount();
    openCreate(fixture, page);

    page.addBox(PRODUCTS[4]);

    expect(page.lines()[0].quantity).toBe(24);
    expect(page.lines()[0].unitPrice).toBe(1);
    expect(page.subtotal).toBe(24);
  });

  it('acumula unidades y cajas del mismo producto en una sola linea', () => {
    const { fixture, page } = mount();
    openCreate(fixture, page);

    page.addProduct(PRODUCTS[4]);
    page.addBox(PRODUCTS[4]);
    page.addProduct(PRODUCTS[4]);

    expect(page.lines().length).toBe(1);
    expect(page.lines()[0].quantity).toBe(26);
    expect(page.subtotal).toBe(26);
  });

  /**
   * En el pedido la caja entra como sus unidades sueltas, asi que se cobra al
   * precio unitario del catalogo: el boton «Caja» de la grilla muestra lo mismo
   * que suma (`boxCharge`), aunque la unidad suelta sea mas cara que la caja.
   */
  it('cobra la unidad suelta y la caja completa al precio unitario del catalogo', () => {
    const { fixture, page } = mount();
    openCreate(fixture, page);
    const malta: ProductOption = { ...PRODUCTS[4], price: 72, unitPrice: 3.5 };

    page.addProduct(malta);

    expect(page.lines()[0].unitPrice).toBe(3.5);
    expect(page.subtotal).toBe(3.5);
    // Una caja completa son 24 unidades al unitario: $ 84 (lo que promete el boton).
    expect(page.boxCharge(malta)).toBe(84);

    page.addBox(malta);

    expect(page.lines().length).toBe(1);
    expect(page.lines()[0].quantity).toBe(25);
    expect(page.subtotal).toBe(87.5);
  });

  it('no permite agregar una caja completa cuando no alcanza el stock en unidades', () => {
    const { fixture, page } = mount();
    openCreate(fixture, page);

    // La caja trae 24 unidades y solo quedan 10 en inventario.
    const casiSinStock: ProductOption = { ...PRODUCTS[4], stock: 10 };
    page.addBox(casiSinStock);

    expect(page.lines().length).toBe(0);
    expect(page.formError()).toContain('No alcanza el stock para una caja completa');
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

  it('calcula subtotal, IGV, propina y el vuelto del cobro en efectivo', () => {
    const { fixture, page } = mount();
    openCreate(fixture, page);

    page.addProduct(PRODUCTS[0]);
    page.form.discount = 5;
    page.setTaxRate(18);

    expect(page.subtotal).toBe(30);
    expect(page.discountAmount).toBe(5);
    expect(page.tax).toBe(4.5);
    // La propina arranca con la sugerencia configurada (10 % del neto: 25 → 2.5).
    expect(page.form.tipRate).toBe(10);
    expect(page.tipAmount).toBe(2.5);
    expect(page.total).toBe(32);

    page.receivedAmount = 0;
    page.setReceived(20);
    expect(page.receivedAmount).toBe(52);
    expect(page.change).toBe(20);

    // La propina es opcional: quitarla devuelve el total de la venta.
    page.setTipRate(0);
    expect(page.tipAmount).toBe(0);
    expect(page.total).toBe(29.5);

    expect(page.createButtonLabel).toBe('Crear y cobrar');
  });

  it('envía la propina sugerida al crear la venta', () => {
    const { fixture, page } = mount();
    openCreate(fixture, page);

    page.addProduct(PRODUCTS[0]);
    page.submitCreate();

    // 10 % de 30 = 3 de propina.
    const createRequest = http.expectOne(
      (request) => request.method === 'POST' && request.url === `${API}/orders`,
    );
    expect(createRequest.request.body.tip).toBe(3);

    createRequest.flush(order({ tip: 3, total: 33 }));

    const payRequest = http.expectOne(`${API}/orders/o1/payments`);
    expect(payRequest.request.body.amount).toBe(33);
    payRequest.flush(order({ tip: 3, total: 33, paymentStatus: 'PAID', status: 'COMPLETED' }));

    flushReload();
  });

  it('suma el delivery al total de un pedido a domicilio y lo envía al crear la venta', () => {
    const { fixture, page } = mount();
    openCreate(fixture, page);
    // Tasas cargadas: el desglose muestra el monto en cada tasa del sistema.
    rates.load();
    http.expectOne(`${API}/rates`).flush(RATES_SNAPSHOT);
    fixture.detectChanges();

    page.addProduct(PRODUCTS[0]);
    page.setTipRate(0);

    // En un pedido de mostrador el costo de delivery no aplica aunque se escriba.
    page.form.deliveryFee = 5;
    expect(page.isDeliveryOrder).toBeFalse();
    expect(page.deliveryFeeAmount).toBe(0);
    expect(page.total).toBe(30);

    page.form.type = 'DELIVERY';
    fixture.detectChanges();

    // 30 de la venta + 5 de delivery: el costo no paga IGV ni genera propina.
    expect(page.isDeliveryOrder).toBeTrue();
    expect(page.deliveryFeeAmount).toBe(5);
    expect(page.total).toBe(35);

    const text = (fixture.nativeElement.textContent as string).replace(/\s+/g, ' ');
    expect(text).toContain('Costo de delivery');
    for (const label of ['BCV $', 'BCV €', 'Personalizada']) {
      expect(text).toContain(label);
    }

    page.submitCreate();

    const createRequest = http.expectOne(
      (request) => request.method === 'POST' && request.url === `${API}/orders`,
    );
    expect(createRequest.request.body.type).toBe('DELIVERY');
    expect(createRequest.request.body.deliveryFee).toBe(5);
    expect(createRequest.request.body.deliveryFeeCurrency).toBe('USD');

    createRequest.flush(order({ type: 'DELIVERY', deliveryFee: 5, total: 35 }));

    const payRequest = http.expectOne(`${API}/orders/o1/payments`);
    expect(payRequest.request.body.amount).toBe(35);
    payRequest.flush(
      order({ type: 'DELIVERY', deliveryFee: 5, total: 35, paymentStatus: 'PAID' }),
    );

    flushReload();
  });

  it('no adjunta el costo de delivery en pedidos que no son a domicilio', () => {
    const { fixture, page } = mount();
    openCreate(fixture, page);

    page.addProduct(PRODUCTS[0]);
    page.setTipRate(0);
    // Costo escrito a mano, pero el pedido se sirve en el salón: no viaja.
    page.form.deliveryFee = 5;
    page.submitCreate();

    const createRequest = http.expectOne(
      (request) => request.method === 'POST' && request.url === `${API}/orders`,
    );
    expect(createRequest.request.body.deliveryFee).toBeUndefined();
    expect(createRequest.request.body.deliveryFeeCurrency).toBeUndefined();

    createRequest.flush(order({ total: 30 }));

    const payRequest = http.expectOne(`${API}/orders/o1/payments`);
    expect(payRequest.request.body.amount).toBe(30);
    payRequest.flush(order({ total: 30, paymentStatus: 'PAID' }));

    flushReload();
  });

  it('muestra el desglose de las 3 tasas en el cobro y conserva el delivery del pedido', () => {
    const { fixture, page } = mount();
    rates.load();
    http.expectOne(`${API}/rates`).flush(RATES_SNAPSHOT);

    page.openPay(order({ type: 'DELIVERY', deliveryFee: 5, total: 35 }));
    fixture.detectChanges();

    const text = (fixture.nativeElement.textContent as string).replace(/\s+/g, ' ');
    expect(text).toContain('Delivery (incluido)');
    // El monto a cobrar se muestra en cada tasa del sistema.
    for (const label of ['BCV $', 'BCV €', 'Personalizada']) {
      expect(text).toContain(label);
    }
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
      parts: [{ amount: 30, method: 'CASH', currency: 'USD' }],
      change: [],
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
    http.expectOne(`${API}/menus/options`).flush([]);
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
    http.expectOne(`${API}/menus/options`).flush([]);
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
    // El cobro incluye la propina sugerida: 30 + 3 de propina = 33 USD * 876.7976.
    expect(page.tipAmount).toBe(3);
    expect(page.chargeTotal).toBe(28934.32);

    page.submitCreate();

    const createRequest = http.expectOne(
      (request) => request.method === 'POST' && request.url === `${API}/orders`,
    );
    createRequest.flush(order({ tip: 3, total: 33 }));

    const payRequest = http.expectOne(`${API}/orders/o1/payments`);
    expect(payRequest.request.body).toEqual({
      amount: 28934.32,
      method: 'CASH',
      currency: 'VES',
      parts: [{ amount: 28934.32, method: 'CASH', currency: 'VES' }],
      change: [],
    });
    payRequest.flush(order({ tip: 3, total: 33, paymentStatus: 'PAID' }));

    flushReload();
  });

  /**
   * Configuración → Cajero puede fijar la **tasa de cobro** de la empresa (el BCV):
   * la venta de mostrador cobra el precio que se lee en pantalla —los bolívares—
   * pasado a esa tasa, y el cobro viaja con ella para que el backend haga la misma
   * cuenta contra el saldo del pedido.
   */
  it('cobra la venta de mostrador con la tasa de cobro del cajero', () => {
    chargeRate('BCV_USD');
    const { fixture, page } = mount();
    openCreate(fixture, page);

    // Llegan las tasas: los precios se ven en bolívares (personalizada 950).
    rates.load(true);
    http.expectOne(`${API}/rates?refresh=true`).flush(POS_RATES);
    fixture.detectChanges();

    // Sin propina, para que el total sea el del producto.
    page.form.tipRate = 0;
    page.addProduct(PRODUCTS[0]);

    // 30 USD se ven como Bs 28.500,00 y, pagando en bolívares, el cliente entrega
    // ese precio tal cual.
    page.onChargeCurrencyChange('VES');
    expect(page.chargeTotal).toBe(28500);
    // En divisas, al cambio del BCV (876,7976), ese precio son 32,50 USD.
    page.onChargeCurrencyChange('USD');
    expect(page.chargeTotal).toBe(32.5);

    page.submitCreate();

    const createRequest = http.expectOne(
      (request) => request.method === 'POST' && request.url === `${API}/orders`,
    );
    createRequest.flush(order({ total: 30 }));

    const payRequest = http.expectOne(`${API}/orders/o1/payments`);
    expect(payRequest.request.body).toEqual({
      amount: 32.5,
      method: 'CASH',
      currency: 'USD',
      rateKey: 'BCV_USD',
      parts: [{ amount: 32.5, method: 'CASH', currency: 'USD' }],
      change: [],
    });
    payRequest.flush(order({ total: 30, paidAmount: 32.5, paymentStatus: 'PAID' }));

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

  // ------------------ Preferencia de la interfaz (modal / lateral) --------------

  /** Elige la presentación de los formularios antes de montar la página. */
  function preferForms(view: 'modal' | 'sidebar'): void {
    TestBed.inject(PreferencesService).setDialogView(view);
    // La preferencia es de la empresa: la petición se responde al vuelo.
    http
      .expectOne(
        (request) => request.method === 'PATCH' && request.url === `${API}/preferences`,
      )
      .flush({ tipPercent: 10, dialogView: view, priceCurrency: null });
  }

  /** Fija la tasa de cobro de la empresa (Configuración → Cajero). */
  function chargeRate(key: string): void {
    TestBed.inject(PreferencesService).setChargeRateKey(key);
    http
      .expectOne(
        (request) => request.method === 'PATCH' && request.url === `${API}/preferences`,
      )
      .flush({ tipPercent: 10, dialogView: 'modal', priceCurrency: null, chargeRateKey: key });
  }

  it('abre el nuevo pedido en una ventana modal por defecto', () => {
    const { fixture, page } = mount();
    openCreate(fixture, page);
    fixture.detectChanges();

    const root: HTMLElement = fixture.nativeElement;
    const modal = root.querySelector('app-modal');
    expect(modal).not.toBeNull();
    expect(root.querySelector('app-sidebar')).toBeNull();
    // El mismo formulario (cuerpo y pie) se dibuja dentro de la ventana.
    expect(modal!.textContent).toContain('Productos');
    expect(modal!.querySelector('.dialog-footer button')!.textContent).toContain('Cancelar');
  });

  it('abre el nuevo pedido en el panel lateral si esa es la preferencia', () => {
    preferForms('sidebar');
    const { fixture, page } = mount();
    openCreate(fixture, page);
    fixture.detectChanges();

    const root: HTMLElement = fixture.nativeElement;
    const aside = root.querySelector('app-sidebar aside');
    expect(aside).not.toBeNull();
    expect(root.querySelector('app-modal')).toBeNull();
    expect(aside!.textContent).toContain('Nuevo pedido');
    expect(aside!.textContent).toContain('Productos');

    // El pie vive en la barra inferior del panel y sigue respondiendo al host.
    const cancel: HTMLButtonElement = aside!.querySelector('.dialog-footer button')!;
    expect(cancel.textContent).toContain('Cancelar');
    cancel.click();
    fixture.detectChanges();
    expect(page.createOpen()).toBeFalse();
    expect(root.querySelector('app-sidebar aside')).toBeNull();
  });

  it('muestra el historial de tasas del dia guardado en el cobro', () => {
    const { fixture, page } = mount();
    openDetailWithItem(
      fixture,
      page,
      detailOrderWithItem({
        paymentStatus: 'PAID',
        paidAmount: 60,
        payments: [
          {
            id: 'pay1',
            orderId: 'o1',
            amount: 57000,
            method: 'CASH',
            currency: 'VES',
            exchangeRate: 950,
            rateKey: 'CUSTOM_USD',
            ratesHistory: {
              capturedAt: '2026-10-13T21:00:00.000Z',
              bcvDate: '2026-10-13',
              stale: false,
              activeKey: 'CUSTOM_USD',
              rates: [
                {
                  key: 'BCV_USD',
                  currency: 'USD',
                  source: 'BCV',
                  rate: 900,
                  date: '2026-10-13',
                },
                {
                  key: 'BCV_EUR',
                  currency: 'EUR',
                  source: 'BCV',
                  rate: 1000,
                  date: '2026-10-13',
                },
                {
                  key: 'CUSTOM_USD',
                  currency: 'USD',
                  source: 'CUSTOM',
                  rate: 950,
                  date: null,
                },
              ],
            },
            baseAmount: 60,
            createdAt: '2026-10-13T21:00:00.000Z',
          },
        ],
      }),
    );

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    // La tasa con la que se cobro queda etiquetada en el pago...
    expect(text).toContain('Personalizada');
    // ...y se listan TODAS las tasas que estaban vigentes ese dia.
    expect(text).toContain(
      'Tasas del día: BCV $ 900.00 · BCV € 1,000.00 · Personalizada 950.00',
    );
  });

  it('abre el detalle del pedido en el panel lateral y lo cierra desde su pie', () => {
    preferForms('sidebar');
    const { fixture, page } = mount();
    openDetailWithItem(fixture, page, detailOrderWithItem());

    const root: HTMLElement = fixture.nativeElement;
    const aside = root.querySelector('app-sidebar aside');
    expect(aside).not.toBeNull();
    expect(root.querySelector('app-modal')).toBeNull();
    expect(aside!.textContent).toContain('Pedido PED-0001');

    const close = Array.from(
      aside!.querySelectorAll<HTMLButtonElement>('.dialog-footer button'),
    ).find((button) => button.textContent?.includes('Cerrar'));
    expect(close).toBeDefined();
    close!.click();
    fixture.detectChanges();
    expect(page.detailOpen()).toBeFalse();
    expect(root.querySelector('app-sidebar aside')).toBeNull();
  });

  it('cancela con el OTP de 8 letras en mayúsculas', () => {
    const { fixture, page } = mount();
    const target = order({ id: 'o-otp', code: 'PED-OTP' });

    const reload = spyOn(
      page as unknown as { reload: () => void },
      'reload',
    );
    page.cancelOpen.set(true);
    page.cancelOrder.set(target);
    page.setCancelCode('abcdefgh');
    expect(page.cancelCode()).toBe('ABCDEFGH');

    page.submitCancellation();
    const request = http.expectOne({
      method: 'PATCH',
      url: `${API}/orders/o-otp/status`,
    });
    expect(request.request.body).toEqual({
      status: 'CANCELLED',
      code: 'ABCDEFGH',
    });
    request.flush({ ...target, status: 'CANCELLED' });
    fixture.detectChanges();

    expect(page.cancelOpen()).toBeFalse();
    expect(reload).toHaveBeenCalled();
  });
});
