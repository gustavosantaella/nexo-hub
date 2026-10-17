import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { environment } from '../../../environments/environment';
import type { Category, ProductOption } from '../../core/models/api.model';
import type { MenuOption } from '../../core/models/api.model';
import type { Order, OrderItem } from '../../core/models/operations.model';
import type { RatesSnapshot } from '../../core/models/rates.model';
import { RatesService } from '../../core/services/rates.service';
import { ConfirmService } from '../../shared/services/confirm.service';
import { money, setDisplayCurrency } from '../../core/utils/format';
import { unitPriceOf } from '../../core/utils/product-pricing';
import { PosComponent } from './pos.component';

const API = environment.apiUrl;

/** Clave de `localStorage` de las conversiones que ve el cajero. */
const CONVERSION_CURRENCIES_KEY = 'nexo-hub.conversion-currencies';

/** Clave de `localStorage` del precio en dólares del BCV. */
const SHOW_BCV_PRICE_KEY = 'nexo-hub.show-bcv-price';

/** Clave de `localStorage` de la tasa de cobro del cajero. */
const CHARGE_RATE_KEY = 'nexo-hub.charge-rate';

/**
 * Tasas de la empresa del punto de venta: los precios se ven en BOLÍVARES con la
 * tasa personalizada del local (950) activa, mientras el BCV (876,7976) marca
 * 876,7976 Bs por dólar. Es el caso del cajero que cobra al BCV.
 */
const RATES: RatesSnapshot = {
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

/** Catalogo de la venta: un producto suelto y una caja de 24 a $ 24. */
const PRODUCTS: ProductOption[] = [
  {
    id: 'p1',
    sku: 'CAFE-01',
    name: 'Cafe pasado',
    price: 30,
    stock: 10,
    unit: 'UND',
    unitsPerBox: 1,
  },
  {
    id: 'p2',
    sku: 'MALTIN-24',
    name: 'Malta (caja 24)',
    price: 24,
    stock: 48,
    unit: 'CAJA',
    unitsPerBox: 24,
  },
];

/** Carta de menús: una parrilla disponible y un plato agotado. */
const MENUS: MenuOption[] = [
  {
    id: 'm1',
    code: 'MEN-0001',
    name: 'Parrilla',
    price: 18,
    cost: 7,
    availability: 'ALL',
    margin: 11,
    maxServings: 5,
    available: true,
    inactiveIngredients: [],
    ingredients: [
      {
        quantity: 0.1,
        product: {
          id: 'p1',
          name: 'Carne',
          unit: 'KG',
          stock: 0.5,
          trackStock: true,
          active: true,
        },
      },
    ],
  },
  {
    id: 'm2',
    code: 'MEN-0002',
    name: 'Plato agotado',
    price: 10,
    cost: 5,
    availability: 'ALL',
    margin: 5,
    maxServings: 0,
    available: false,
    inactiveIngredients: [],
    ingredients: [],
  },
  {
    // Receta con un producto desactivado: hay stock, pero no se puede vender.
    id: 'm3',
    code: 'MEN-0003',
    name: 'Combo con insumo viejo',
    price: 12,
    cost: 4,
    availability: 'ALL',
    margin: 8,
    maxServings: 12,
    available: false,
    inactiveIngredients: [{ id: 'p9', name: 'Insumo viejo' }],
    ingredients: [
      {
        quantity: 1,
        product: {
          id: 'p9',
          name: 'Insumo viejo',
          unit: 'UND',
          stock: 12,
          trackStock: true,
          active: false,
        },
      },
    ],
  },
];

function order(partial: Partial<Order> = {}): Order {
  return {
    id: 'o1',
    code: 'PED-0001',
    type: 'DINE_IN',
    status: 'PENDING',
    paymentStatus: 'UNPAID',
    subtotal: 100,
    discount: 0,
    tax: 0,
    tip: 0,
    deliveryFee: 0,
    total: 100,
    paidAmount: 0,
    createdAt: '2026-10-13T10:00:00.000Z',
    updatedAt: '2026-10-13T10:00:00.000Z',
    ...partial,
  };
}

/**
 * Pruebas del punto de venta del cajero: venta de unidades sueltas, propina
 * opcional y cobro en una sola acción.
 */
describe('PosComponent (vista de cajero)', () => {
  let http: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PosComponent],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();

    http = TestBed.inject(HttpTestingController);
    // La propina sugerida vive en `localStorage`: se limpia entre pruebas.
    localStorage.clear();
  });

  afterEach(() => {
    http.verify();
    localStorage.clear();
    // La moneda de visualización vive en un signal global: sin esto contaminaría
    // los montos de las demás pruebas del archivo.
    setDisplayCurrency(null);
  });

  function mount(
    menus: MenuOption[] = [],
    openCart = true,
  ): {
    fixture: ComponentFixture<PosComponent>;
    pos: PosComponent;
  } {
    const fixture = TestBed.createComponent(PosComponent);
    const pos = fixture.componentInstance;
    fixture.detectChanges();

    http.expectOne(`${API}/products/options`).flush(PRODUCTS);
    http.expectOne(`${API}/menus/options`).flush(menus);
    http.expectOne(`${API}/menu-categories/options`).flush([]);
    http.expectOne(`${API}/categories/options`).flush([]);
    http.expectOne(`${API}/customers/options`).flush([]);
    http.expectOne(`${API}/cash/current`).flush({
      session: {
        id: 's1',
        code: 'CAJ-0001',
        status: 'OPEN',
        openingAmount: 100,
        openedAt: '2026-10-13T08:00:00.000Z',
      },
      summary: null,
    });
    http.expectOne(`${API}/orders/active`).flush([]);
    fixture.detectChanges();

    // La tarjeta de cobro es un panel lateral: las pruebas que validan su
    // contenido lo abren; las que prueban el estado inicial lo dejan cerrado.
    if (openCart) {
      pos.cartOpen.set(true);
      fixture.detectChanges();
    }

    return { fixture, pos };
  }

  /** Resuelve las consultas que dispara el POS al reiniciar la venta. */
  function flushReload(): void {
    http
      .match(`${API}/cash/current`)
      .forEach((request) => request.flush({ session: null, summary: null }));
    http.match(`${API}/orders/active`).forEach((request) => request.flush([]));
    http.match(`${API}/products/options`).forEach((request) => request.flush(PRODUCTS));
    http.match(`${API}/menus/options`).forEach((request) => request.flush([]));
    http
      .match(`${API}/menu-categories/options`)
      .forEach((request) => request.flush([]));
    http.match(`${API}/categories/options`).forEach((request) => request.flush([]));
    http.match(`${API}/customers/options`).forEach((request) => request.flush([]));
  }

  /**
   * La tarjeta de cobro ya no ocupa una columna fija: vive en un panel lateral
   * que arranca cerrado y se abre desde el botón flotante con icono de factura.
   */
  it('abre la tarjeta de cobro en un panel lateral desde el botón flotante', () => {
    const { fixture, pos } = mount([], false);

    expect(pos.cartOpen()).toBeFalse();
    expect(fixture.nativeElement.querySelector('aside[role="dialog"]')).toBeNull();

    const toggle = fixture.nativeElement.querySelector(
      '[data-pos-cart-toggle]',
    ) as HTMLButtonElement | null;
    expect(toggle).not.toBeNull();
    // El botón flotante se identifica con el icono de factura.
    expect(toggle!.querySelector('app-icon')).not.toBeNull();

    toggle!.click();
    fixture.detectChanges();

    expect(pos.cartOpen()).toBeTrue();
    const panel = fixture.nativeElement.querySelector(
      'aside[role="dialog"]',
    ) as HTMLElement | null;
    expect(panel).not.toBeNull();
    expect(panel!.textContent).toContain('Venta actual');
    expect(panel!.textContent).toContain('Cobro');
    expect(panel!.textContent).toContain('Guardar');
  });

  /**
   * El pie del panel trae un botón **Vaciar** que deja la venta en blanco: no
   * solo quita el carrito, también borra cliente, mesa, notas, descuentos,
   * delivery y los datos del cobro. El panel sigue abierto para empezar de nuevo.
   */
  it('vacía todo el contenido de la venta desde el botón Vaciar del sidebar', () => {
    const { fixture, pos } = mount();

    pos.addProduct(PRODUCTS[0]);
    pos.form.type = 'DELIVERY';
    pos.form.customerId = 'c1';
    pos.form.tableNumber = '4';
    pos.form.notes = 'Sin cebolla';
    pos.form.discount = 5;
    pos.form.taxRate = 18;
    pos.form.tipEnabled = false;
    pos.form.tipRate = 0;
    pos.form.deliveryFee = 4;
    pos.charge.method = 'CASH';
    pos.charge.currency = 'VES';
    pos.charge.received = 100;
    pos.formError.set('Error de prueba');
    fixture.detectChanges();

    const clear = fixture.nativeElement.querySelector(
      '[data-pos-clear]',
    ) as HTMLButtonElement | null;
    expect(clear).not.toBeNull();
    expect(clear!.textContent).toContain('Vaciar');

    clear!.click();
    fixture.detectChanges();

    expect(pos.lines().length).toBe(0);
    expect(pos.total).toBe(0);
    expect(pos.form.customerId).toBe('');
    expect(pos.form.type).toBe('DINE_IN');
    expect(pos.form.tableNumber).toBe('');
    expect(pos.form.notes).toBe('');
    expect(pos.form.discount).toBe(0);
    expect(pos.form.taxRate).toBe(0);
    // La venta nueva vuelve a arrancar con la propina configurada por el admin.
    expect(pos.form.tipEnabled).toBeTrue();
    expect(pos.form.tipRate).toBe(10);
    expect(pos.form.deliveryFee).toBe(0);
    expect(pos.charge.currency).toBe('USD');
    expect(pos.charge.received).toBe(0);
    expect(pos.formError()).toBeNull();
    // El panel no se cierra: queda listo para una venta nueva.
    expect(pos.cartOpen()).toBeTrue();
    expect(fixture.nativeElement.textContent).toContain(
      'Toca un producto de la grilla para empezar la venta.',
    );
  });

  /**
   * Tercera pestaña del POS: los pedidos que se guardaron sin cobrar quedan a la
   * vista aunque no tengan mesa, y se pueden retomar o cobrar desde ahí.
   */
  it('lista los pedidos guardados en su propia pestaña y permite retomarlos', () => {
    const { fixture, pos } = mount([], false);

    const tab = fixture.nativeElement.querySelector(
      '[data-pos-tab-saved]',
    ) as HTMLButtonElement | null;
    expect(tab).not.toBeNull();
    expect(tab!.textContent).toContain('Guardados');

    tab!.click();
    fixture.detectChanges();

    expect(pos.tab()).toBe('saved');
    expect(fixture.nativeElement.textContent).toContain('No hay pedidos guardados');

    pos.activeOrders.set([
      order({
        id: 'o2',
        code: 'PED-0002',
        tableNumber: '4',
        subtotal: 60,
        total: 60,
        paidAmount: 20,
        paymentStatus: 'PARTIAL',
        createdAt: '2026-10-13T11:00:00.000Z',
        items: [
          {
            id: 'i2',
            orderId: 'o2',
            productId: 'p1',
            name: 'Cafe pasado',
            quantity: 2,
            unitPrice: 30,
            total: 60,
          },
        ],
      }),
      order({
        id: 'o3',
        code: 'PED-0003',
        type: 'TAKEAWAY',
        subtotal: 30,
        total: 30,
        createdAt: '2026-10-13T12:00:00.000Z',
        items: [
          {
            id: 'i3',
            orderId: 'o3',
            productId: 'p1',
            name: 'Cafe pasado',
            quantity: 1,
            unitPrice: 30,
            total: 30,
          },
        ],
      }),
    ]);
    fixture.detectChanges();

    const cards = fixture.nativeElement.querySelectorAll(
      '[data-pos-saved-order]',
    ) as NodeListOf<HTMLElement>;
    expect(cards.length).toBe(2);
    // El más reciente queda primero para encontrarlo al terminar de guardarlo.
    expect(cards[0].textContent).toContain('PED-0003');
    expect(cards[0].textContent).toContain('Para llevar');
    expect(cards[0].textContent).toContain('1 × Cafe pasado');
    expect(cards[1].textContent).toContain('PED-0002');
    expect(cards[1].textContent).toContain('Mesa 4');
    expect(cards[1].textContent).toContain('Pago parcial');
    expect(tab!.textContent).toContain('2');

    // «Cobrar» reabre el pedido en la vista de venta con el saldo pendiente.
    const charge = cards[1].querySelector(
      '[data-pos-saved-charge]',
    ) as HTMLButtonElement | null;
    expect(charge).not.toBeNull();
    charge!.click();
    fixture.detectChanges();

    expect(pos.tab()).toBe('sale');
    expect(pos.targetOrder()?.id).toBe('o2');
    expect(pos.cartOpen()).toBeTrue();

    // «Agregar» también retoma el pedido guardado.
    pos.tab.set('saved');
    fixture.detectChanges();
    const add = fixture.nativeElement.querySelector(
      '[data-pos-saved-add]',
    ) as HTMLButtonElement | null;
    expect(add).not.toBeNull();
    add!.click();
    fixture.detectChanges();

    expect(pos.tab()).toBe('sale');
    expect(pos.targetOrder()?.id).toBe('o3');
    expect(pos.cartOpen()).toBeTrue();
  });

  /**
   * Un pedido guardado se puede corregir: el cajero despliega sus productos y
   * quita el que se cargó por error. El backend devuelve el stock al inventario y
   * la tarjeta toma los totales recalculados de la respuesta.
   */
  it('permite quitar un producto de un pedido guardado', async () => {
    const { fixture, pos } = mount([], false);
    const items: OrderItem[] = [
      {
        id: 'i2',
        orderId: 'o2',
        productId: 'p1',
        name: 'Cafe pasado',
        quantity: 2,
        unitPrice: 30,
        total: 60,
      },
      {
        id: 'i4',
        orderId: 'o2',
        productId: 'p2',
        name: 'Malta',
        quantity: 1,
        unitPrice: 10,
        total: 10,
      },
    ];
    const saved = order({
      id: 'o2',
      code: 'PED-0002',
      subtotal: 70,
      total: 70,
      items,
    });

    pos.activeOrders.set([saved]);
    pos.tab.set('saved');
    fixture.detectChanges();

    // La tarjeta deja abrir la lista de productos antes de tocar la papelera.
    const toggle = fixture.nativeElement.querySelector(
      '[data-pos-saved-toggle-items]',
    ) as HTMLButtonElement | null;
    expect(toggle).not.toBeNull();
    expect(toggle!.textContent).toContain('Editar productos');
    toggle!.click();
    fixture.detectChanges();

    const rows = fixture.nativeElement.querySelectorAll(
      '[data-pos-saved-item]',
    ) as NodeListOf<HTMLElement>;
    expect(rows.length).toBe(2);
    expect(rows[0].textContent).toContain('2 × Cafe pasado');
    expect(rows[1].textContent).toContain('1 × Malta');

    const remove = rows[0].querySelector(
      '[data-pos-saved-remove-item]',
    ) as HTMLButtonElement | null;
    expect(remove).not.toBeNull();
    expect(remove!.textContent).toContain('Quitar');
    expect(remove!.title).toBe('Quitar producto');
    expect(remove!.getAttribute('aria-label')).toBe(
      'Quitar Cafe pasado del pedido PED-0002',
    );

    // Primero confirma: un descuido del cajero no debe borrar el producto.
    const confirm = TestBed.inject(ConfirmService);
    const removal = pos.removeOrderItem(saved, items[0]);
    expect(confirm.state().open).toBeTrue();
    expect(confirm.state().message).toContain('Cafe pasado');
    confirm.resolve(true);
    await removal;

    const request = http.expectOne(`${API}/orders/o2/items/i2`);
    expect(request.request.method).toBe('DELETE');
    const remaining = { ...saved, subtotal: 10, total: 10, items: [items[1]] };
    request.flush(remaining);
    fixture.detectChanges();

    expect(pos.savedOrders[0].total).toBe(10);
    expect(pos.savedOrders[0].items?.length).toBe(1);
    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('Malta');
    expect(text).not.toContain('Cafe pasado');

    // Si solo queda una línea, el cajero también puede corregirla: se confirma
    // la cancelación del pedido y el backend devuelve todo el stock.
    const lastRemove = fixture.nativeElement.querySelector(
      '[data-pos-saved-remove-item]',
    ) as HTMLButtonElement | null;
    expect(lastRemove).not.toBeNull();
    expect(lastRemove!.disabled).toBeFalse();
    expect(lastRemove!.title).toBe('Quitar el último producto (cancela el pedido)');
    expect(lastRemove!.getAttribute('aria-label')).toBe(
      'Cancelar el pedido PED-0002 y quitar Malta',
    );

    const cancellation = pos.removeOrderItem(pos.savedOrders[0], items[1]);
    expect(confirm.state().open).toBeTrue();
    expect(confirm.state().title).toBe('Cancelar pedido');
    expect(confirm.state().message).toContain('se cancelará el pedido completo');
    confirm.resolve(true);
    await cancellation;

    const cancelRequest = http.expectOne(`${API}/orders/o2/status`);
    expect(cancelRequest.request.method).toBe('PATCH');
    expect(cancelRequest.request.body).toEqual({ status: 'CANCELLED' });
    cancelRequest.flush({ ...remaining, status: 'CANCELLED' });
    fixture.detectChanges();

    expect(pos.savedOrders.length).toBe(0);
    expect(fixture.nativeElement.textContent).toContain('No hay pedidos guardados');
  });

  /**
   * El panel lateral de cobro también es una vía para corregir una mesa o un
   * guardado: cada producto ya cargado se puede quitar y el pedido completo se
   * puede cancelar sin salir de la venta.
   */
  it('permite quitar productos y cancelar el pedido desde el panel lateral', async () => {
    const { fixture, pos } = mount();
    const items: OrderItem[] = [
      {
        id: 'i1',
        orderId: 'o9',
        productId: 'p1',
        name: 'Cafe pasado',
        quantity: 2,
        unitPrice: 30,
        total: 60,
      },
      {
        id: 'i2',
        orderId: 'o9',
        productId: 'p2',
        name: 'Malta (caja 24)',
        quantity: 24,
        unitPrice: 1,
        total: 24,
      },
    ];
    const tableOrder = order({
      id: 'o9',
      code: 'PED-0009',
      tableNumber: '4',
      items,
      subtotal: 84,
      total: 84,
    });

    pos.activeOrders.set([tableOrder]);
    pos.startAddToOrder(tableOrder);
    fixture.detectChanges();

    // Los productos ya cargados en la mesa tienen su propia papelera.
    const removeButtons = fixture.nativeElement.querySelectorAll(
      '[data-pos-target-remove-item]',
    ) as NodeListOf<HTMLButtonElement>;
    expect(removeButtons.length).toBe(2);
    expect(removeButtons[0].textContent).toContain('Quitar');
    expect(removeButtons[0].getAttribute('aria-label')).toBe(
      'Quitar Cafe pasado del pedido PED-0009',
    );

    const confirm = TestBed.inject(ConfirmService);
    const removal = pos.removeOrderItem(tableOrder, items[0]);
    expect(confirm.state().open).toBeTrue();
    expect(confirm.state().message).toContain('Cafe pasado');
    confirm.resolve(true);
    await removal;

    const request = http.expectOne(`${API}/orders/o9/items/i1`);
    expect(request.request.method).toBe('DELETE');
    const remaining = {
      ...tableOrder,
      subtotal: 24,
      total: 24,
      items: [items[1]],
    };
    request.flush(remaining);
    fixture.detectChanges();

    // El panel y la cuenta se actualizan sin salir del modo cobro.
    expect(pos.targetOrder()?.items?.length).toBe(1);
    expect(pos.bill.subtotal).toBe(24);
    expect(pos.bill.total).toBe(24);
    const text = (fixture.nativeElement.querySelector(
      '[data-pos-cart-panel]',
    ) as HTMLElement).textContent as string;
    expect(text).not.toContain('Cafe pasado');
    expect(text).toContain('Malta (caja 24)');

    // El botón de cancelar vive junto a «Salir del pedido».
    const cancelButton = fixture.nativeElement.querySelector(
      '[data-pos-cancel-order]',
    ) as HTMLButtonElement | null;
    expect(cancelButton).not.toBeNull();
    expect(cancelButton!.textContent).toContain('Cancelar pedido');

    const cancellation = pos.cancelOrder(pos.targetOrder()!);
    expect(confirm.state().open).toBeTrue();
    expect(confirm.state().title).toBe('Cancelar pedido');
    expect(confirm.state().message).toContain('PED-0009');
    confirm.resolve(true);
    await cancellation;

    const cancelRequest = http.expectOne(`${API}/orders/o9/status`);
    expect(cancelRequest.request.method).toBe('PATCH');
    expect(cancelRequest.request.body).toEqual({ status: 'CANCELLED' });
    cancelRequest.flush({ ...remaining, status: 'CANCELLED' });
    fixture.detectChanges();

    expect(pos.targetOrder()).toBeNull();
    expect(pos.activeOrders().length).toBe(0);
    expect(pos.cartOpen()).toBeFalse();
    expect(fixture.nativeElement.querySelector('aside[role="dialog"]')).toBeNull();
  });

  /**
   * Si el pedido abierto en el panel tiene una sola línea, quitarla cancela el
   * pedido completo y descarta la venta en curso en vez de dejar un carrito vacío.
   */
  it('cancela el pedido al quitar su último producto desde el panel lateral', async () => {
    const { fixture, pos } = mount();
    const items: OrderItem[] = [
      {
        id: 'i1',
        orderId: 'o9',
        productId: 'p1',
        name: 'Cafe pasado',
        quantity: 2,
        unitPrice: 30,
        total: 60,
      },
    ];
    const tableOrder = order({
      id: 'o9',
      code: 'PED-0009',
      tableNumber: '4',
      items,
      subtotal: 60,
      total: 60,
    });

    pos.activeOrders.set([tableOrder]);
    pos.startAddToOrder(tableOrder);
    fixture.detectChanges();

    const remove = fixture.nativeElement.querySelector(
      '[data-pos-target-remove-item]',
    ) as HTMLButtonElement | null;
    expect(remove).not.toBeNull();
    expect(remove!.title).toBe('Quitar el último producto (cancela el pedido)');
    expect(remove!.getAttribute('aria-label')).toBe(
      'Cancelar el pedido PED-0009 y quitar Cafe pasado',
    );

    const confirm = TestBed.inject(ConfirmService);
    const removal = pos.removeOrderItem(tableOrder, items[0]);
    expect(confirm.state().open).toBeTrue();
    expect(confirm.state().title).toBe('Cancelar pedido');
    expect(confirm.state().message).toContain('se cancelará el pedido completo');
    confirm.resolve(true);
    await removal;

    const request = http.expectOne(`${API}/orders/o9/status`);
    expect(request.request.method).toBe('PATCH');
    expect(request.request.body).toEqual({ status: 'CANCELLED' });
    request.flush({ ...tableOrder, status: 'CANCELLED' });
    fixture.detectChanges();

    expect(pos.targetOrder()).toBeNull();
    expect(pos.activeOrders().length).toBe(0);
    expect(pos.cartOpen()).toBeFalse();
  });

  /**
   * Presentaciones: al agregar una caja/paquete el POS pregunta qué se entrega y
   * cada opción se cobra a su precio (la caja al del catálogo, la unidad suelta al
   * repartido). El carrito guarda siempre unidades de inventario.
   */
  it('pide elegir caja o unidad suelta al agregar un producto por presentación', () => {
    const { fixture, pos } = mount();

    // Tocar la caja en la grilla abre el selector y todavía no agrega nada.
    pos.addProduct(PRODUCTS[1]);
    fixture.detectChanges();

    expect(pos.unitPicker()?.id).toBe('p2');
    expect(pos.lines().length).toBe(0);
    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('Unidad suelta');
    expect(text).toContain('Caja completa');
    expect(text).toContain('$ 24.00');

    // Unidad suelta: una unidad de inventario al precio repartido ($ 24 / 24).
    pos.pickSaleUnit('UND');
    fixture.detectChanges();

    expect(pos.unitPicker()).toBeNull();
    const suelta = pos.lines()[0];
    expect(pos.lineKey(suelta)).toBe('p:p2|UND');
    expect(suelta.quantity).toBe(1);
    expect(suelta.unitPrice).toBe(1);
    expect(pos.saleQuantity(suelta)).toBe(1);
    expect(pos.salePrice(suelta)).toBe(1);
    expect(pos.saleUnitLabel(suelta)).toBe('unidades sueltas');
    expect(pos.subtotal).toBe(1);

    // Caja completa: línea aparte con su precio del catálogo y sus 24 unidades.
    pos.addBox(PRODUCTS[1]);
    fixture.detectChanges();

    expect(pos.lines().length).toBe(2);
    const caja = pos.lines()[1];
    expect(pos.lineKey(caja)).toBe('p:p2|CAJA');
    expect(caja.quantity).toBe(24);
    expect(pos.saleQuantity(caja)).toBe(1);
    expect(pos.salePrice(caja)).toBe(24);
    expect(pos.saleUnitLabel(caja)).toBe('cajas');
    expect(pos.subtotal).toBe(25);
  });

  /**
   * El precio unitario del catálogo manda al vender suelto: la caja se sigue
   * cobrando a su precio ($ 72) y sus unidades sueltas al unitario ($ 3.50), que
   * suele ser más caro que repartir la caja.
   */
  it('cobra la unidad suelta al precio unitario del catálogo y la caja a su precio', () => {
    const { fixture, pos } = mount();
    const malta: ProductOption = { ...PRODUCTS[1], price: 72, unitPrice: 3.5, stock: 48 };

    pos.addProduct(malta);
    pos.pickSaleUnit('UND');
    fixture.detectChanges();

    const suelta = pos.lines()[0];
    expect(suelta.unitPrice).toBe(3.5);
    expect(pos.salePrice(suelta)).toBe(3.5);
    expect(pos.lineTotal(suelta)).toBe(3.5);
    expect(pos.saleUnitLabel(suelta)).toBe('unidades sueltas');

    // La caja completa se cobra al precio del catálogo, no a 24 x 3.50.
    pos.addBox(malta);
    fixture.detectChanges();

    const caja = pos.lines()[1];
    expect(caja.boxPrice).toBe(72);
    expect(pos.saleQuantity(caja)).toBe(1);
    expect(pos.salePrice(caja)).toBe(72);
    expect(pos.lineTotal(caja)).toBe(72);
    expect(pos.subtotal).toBe(75.5);
  });

  /**
   * En el pedido la cantidad viaja en unidades de inventario: la caja manda sus
   * 24 unidades al precio de la caja repartido (72 / 24 = 3) para que el pedido
   * cobre exactamente lo que muestra el carrito.
   */
  it('reparte el precio de la caja entre sus unidades al guardar el pedido', () => {
    const { fixture, pos } = mount();
    const malta: ProductOption = { ...PRODUCTS[1], price: 72, unitPrice: 3.5, stock: 48 };

    pos.setTip(false);
    pos.addProduct(malta);
    pos.pickSaleUnit('CAJA');
    pos.submitSale(true);
    fixture.detectChanges();

    const createRequest = http.expectOne(
      (request) => request.method === 'POST' && request.url === `${API}/orders`,
    );
    expect(createRequest.request.body.items).toEqual([
      { productId: 'p2', quantity: 24, unitPrice: 3 },
    ]);

    createRequest.flush(order({ subtotal: 72, total: 72 }));

    const payRequest = http.expectOne(`${API}/orders/o1/payments`);
    expect(payRequest.request.body.amount).toBe(72);
    payRequest.flush(order({ subtotal: 72, total: 72, paymentStatus: 'PAID' }));

    expect(pos.lines().length).toBe(0);
    flushReload();
  });

  /**
   * La unidad de venta solo cambia cómo se cuenta la línea: una caja de 24 pasa a
   * verse como sus 24 unidades sueltas y el monto sigue siendo el mismo.
   */
  it('cambia la línea de caja a unidades sueltas sin cambiar el monto', () => {
    const { fixture, pos } = mount();

    pos.addBox(PRODUCTS[1]);
    fixture.detectChanges();

    pos.setLineUnit(pos.lines()[0], 'UND');
    fixture.detectChanges();

    const suelta = pos.lines()[0];
    expect(suelta.inputUnit).toBe('UND');
    expect(pos.saleQuantity(suelta)).toBe(24);
    expect(pos.salePrice(suelta)).toBe(1);
    expect(pos.subtotal).toBe(24);

    // Volver a caja conserva las mismas 24 unidades de inventario.
    pos.setLineUnit(suelta, 'CAJA');
    fixture.detectChanges();

    expect(pos.lines()[0].inputUnit).toBe('CAJA');
    expect(pos.saleQuantity(pos.lines()[0])).toBe(1);
    expect(pos.subtotal).toBe(24);
  });

  /** La cantidad se escribe en cajas y se topea con el stock real (en unidades). */
  it('cuenta las cantidades por caja sin pasarse del stock disponible', () => {
    const { fixture, pos } = mount();

    pos.addBox(PRODUCTS[1]);
    const caja = pos.lines()[0];

    pos.incLine(caja);
    expect(pos.saleQuantity(caja)).toBe(2);
    expect(caja.quantity).toBe(48);

    // Con 48 unidades en stock no cabe una tercera caja.
    pos.incLine(caja);
    expect(pos.saleQuantity(caja)).toBe(2);
    expect(pos.formError()).toContain('Stock insuficiente');

    pos.decLine(caja);
    expect(pos.saleQuantity(caja)).toBe(1);

    // Escribir la cantidad a mano la convierte a unidades de inventario.
    pos.onQuantityChange(caja, 2);
    expect(caja.quantity).toBe(48);
    expect(pos.subtotal).toBe(48);
    fixture.detectChanges();
  });

  /** Sin stock para la presentación completa, queda vender unidades sueltas. */
  it('no deja agregar la caja completa cuando el stock no alcanza', () => {
    const { fixture, pos } = mount();
    const casiAgotado = { ...PRODUCTS[1], stock: 5 };

    pos.addProduct(casiAgotado);
    fixture.detectChanges();
    // El selector avisa que la caja no alcanza y no agrega la línea.
    expect(fixture.nativeElement.textContent as string).toContain('no alcanza el stock');

    pos.pickSaleUnit('CAJA');
    expect(pos.lines().length).toBe(0);
    expect(pos.formError()).toContain('No alcanza el stock para una caja completa');

    // La unidad suelta sí se puede vender.
    pos.addProduct(casiAgotado);
    pos.pickSaleUnit('UND');
    expect(pos.lines().length).toBe(1);
    expect(pos.formError()).toBeNull();
  });

  /**
   * Un mismo producto puede ir en dos líneas (una caja y unidades sueltas); el
   * tope de stock se compara contra la suma de las dos.
   */
  it('suma cajas y unidades sueltas antes de compararlas con el stock', () => {
    const { fixture, pos } = mount();
    const producto = { ...PRODUCTS[1], stock: 25 };

    pos.addProduct(producto);
    pos.pickSaleUnit('CAJA');
    pos.addProduct(producto);
    pos.pickSaleUnit('UND');
    fixture.detectChanges();

    const suelta = pos.lines().find((line) => line.inputUnit === 'UND')!;
    pos.onQuantityChange(suelta, 2);
    fixture.detectChanges();

    expect(pos.lines().length).toBe(2);
    // 24 + 2 unidades superan las 25 del inventario.
    expect(pos.stockIssues.length).toBe(2);

    pos.submitSale(false);
    expect(pos.formError()).toContain('cantidad mayor al stock disponible');
    expect(pos.saving()).toBeFalse();
  });

  /**
   * La caja viaja al backend como sus unidades sueltas al precio repartido: es
   * como el pedido descuenta el stock y como el backend recalcula los totales.
   */
  it('cobra la caja completa como sus unidades sueltas al precio repartido', () => {
    const { fixture, pos } = mount();

    pos.setTip(false);
    pos.addProduct(PRODUCTS[1]);
    pos.pickSaleUnit('CAJA');
    pos.submitSale(true);
    fixture.detectChanges();

    const createRequest = http.expectOne(
      (request) => request.method === 'POST' && request.url === `${API}/orders`,
    );
    expect(createRequest.request.body.items).toEqual([
      { productId: 'p2', quantity: 24, unitPrice: 1 },
    ]);

    createRequest.flush(order({ subtotal: 24, total: 24 }));

    const payRequest = http.expectOne(`${API}/orders/o1/payments`);
    expect(payRequest.request.body.amount).toBe(24);
    payRequest.flush(order({ subtotal: 24, total: 24, paymentStatus: 'PAID' }));

    expect(pos.lines().length).toBe(0);
    flushReload();
  });

  /** El lector de códigos también pregunta: el SKU de una caja no elige solo. */
  it('pide la unidad al agregar una caja por código de barras', () => {
    const { fixture, pos } = mount();

    pos.search = 'MALTIN-24';
    pos.addBySearch();
    fixture.detectChanges();

    expect(pos.search).toBe('');
    expect(pos.unitPicker()?.id).toBe('p2');
    expect(pos.lines().length).toBe(0);

    pos.pickSaleUnit('UND');
    expect(pos.lines().length).toBe(1);
    expect(pos.lines()[0].inputUnit).toBe('UND');
  });

  it('aplica la propina configurada solo cuando se elige «Sí»', () => {
    const { fixture, pos } = mount();

    // La venta arranca con la propina que configuró el admin (10 %).
    expect(pos.form.tipEnabled).toBeTrue();
    expect(pos.form.tipRate).toBe(10);
    expect(pos.tipAmount).toBe(0);

    pos.addProduct(PRODUCTS[0]);
    fixture.detectChanges();

    expect(pos.subtotal).toBe(30);
    expect(pos.tipAmount).toBe(3);
    expect(pos.total).toBe(33);

    // «No» deja la propina en cero: no se cobra nada por ese concepto.
    pos.setTip(false);
    fixture.detectChanges();

    expect(pos.form.tipEnabled).toBeFalse();
    expect(pos.form.tipRate).toBe(0);
    expect(pos.tipAmount).toBe(0);
    expect(pos.total).toBe(30);

    // «Sí» vuelve a aplicar el porcentaje configurado por el admin.
    pos.setTip(true);
    expect(pos.form.tipEnabled).toBeTrue();
    expect(pos.form.tipRate).toBe(10);
    expect(pos.tipAmount).toBe(3);

    // La propina no paga IGV: con 18 % de IGV y sin propina son 30 + 5.4.
    pos.form.taxRate = 18;
    pos.setTip(false);
    fixture.detectChanges();

    expect(pos.tipAmount).toBe(0);
    expect(pos.total).toBe(35.4);
  });

  /** La propina ya no se escribe a mano: es un Sí/No con el monto calculado. */
  it('muestra la propina como Sí/No y aplica el monto al instante', () => {
    const { fixture, pos } = mount();
    pos.addProduct(PRODUCTS[0]);
    fixture.detectChanges();

    const panel = fixture.nativeElement.querySelector(
      '[data-pos-tip]',
    ) as HTMLElement | null;
    const yes = fixture.nativeElement.querySelector(
      '[data-pos-tip-yes]',
    ) as HTMLButtonElement;
    const no = fixture.nativeElement.querySelector(
      '[data-pos-tip-no]',
    ) as HTMLButtonElement;
    expect(panel).not.toBeNull();
    expect(panel!.textContent).toContain('Propina');
    expect(panel!.textContent).toContain('Sí');
    expect(panel!.textContent).toContain('No');
    expect(panel!.textContent).toContain('3');
    expect(yes.getAttribute('aria-pressed')).toBe('true');

    no.click();
    fixture.detectChanges();
    expect(pos.form.tipEnabled).toBeFalse();
    expect(pos.tipAmount).toBe(0);
    expect(no.getAttribute('aria-pressed')).toBe('true');

    yes.click();
    fixture.detectChanges();
    expect(pos.form.tipEnabled).toBeTrue();
    expect(pos.tipAmount).toBe(3);
  });

  /**
   * Botón **Actualizar preferencias**: el admin puede guardar la propina, la
   * moneda de los precios, las conversiones y el precio en dólares del BCV
   * mientras la caja está abierta, así que el cajero las trae sin cerrar sesión.
   * La venta en curso no se toca.
   */
  it('trae las preferencias que guardó el admin sin cerrar sesión', () => {
    const { fixture, pos } = mount();
    expect(pos.form.tipRate).toBe(10);

    pos.refreshPreferences();
    fixture.detectChanges();
    // Mientras trae, el botón queda bloqueado para no pedirlo dos veces.
    expect(pos.refreshingPreferences()).toBeTrue();

    http.expectOne({ method: 'GET', url: `${API}/preferences` }).flush({
      tipPercent: 15,
      dialogView: 'modal',
      priceCurrency: 'VES',
      conversionCurrencies: ['USD'],
      showBcvPrice: true,
    });
    // La moneda de los precios y las conversiones se pintan con las tasas en curso.
    http.expectOne({ method: 'GET', url: `${API}/rates` }).flush({
      rates: [],
      currencies: [],
      baseCurrency: null,
    });
    fixture.detectChanges();

    expect(pos.refreshingPreferences()).toBeFalse();
    // Lo que dejó el admin queda en el navegador, que es lo que pinta el POS…
    expect(localStorage.getItem(CONVERSION_CURRENCIES_KEY)).toBe('["USD"]');
    // …incluido el precio en dólares del BCV…
    expect(localStorage.getItem(SHOW_BCV_PRICE_KEY)).toBe('true');
    // …y la propina de la venta ya empezada se queda como estaba.
    expect(pos.form.tipRate).toBe(10);
  });

  it('cobra la venta con la propina incluida en el total', () => {
    const { fixture, pos } = mount();

    pos.addProduct(PRODUCTS[0]);
    pos.submitSale(true);
    fixture.detectChanges();

    const createRequest = http.expectOne(
      (request) => request.method === 'POST' && request.url === `${API}/orders`,
    );
    expect(createRequest.request.body.tip).toBe(3);
    expect(createRequest.request.body.items).toEqual([
      { productId: 'p1', quantity: 1, unitPrice: 30 },
    ]);

    createRequest.flush(order({ tip: 3, total: 33 }));

    // El cobro va por el total del pedido (venta + propina).
    const payRequest = http.expectOne(`${API}/orders/o1/payments`);
    expect(payRequest.request.body).toEqual({ amount: 33, method: 'CASH', currency: 'USD' });
    payRequest.flush(order({ tip: 3, total: 33, paymentStatus: 'PAID', status: 'COMPLETED' }));

    expect(pos.saving()).toBeFalse();
    expect(pos.lines().length).toBe(0);

    flushReload();
  });

  /**
   * Configuración → Cajero permite fijar la **tasa de cobro** de la empresa (el
   * BCV): el cajero cobra el precio que LEE en pantalla —los bolívares— pasado a
   * esa tasa, no los dólares guardados del catálogo. El cobro viaja con la tasa
   * para que el backend haga la misma cuenta contra el saldo del pedido.
   */
  it('cobra el precio que se ve en pantalla con la tasa de cobro del cajero', () => {
    // El admin fijó el BCV como tasa de cobro (Configuración → Cajero).
    localStorage.setItem(CHARGE_RATE_KEY, 'BCV_USD');
    const { fixture, pos } = mount();

    // Las tasas llegan (con los precios en bolívares y la personalizada activa).
    TestBed.inject(RatesService).load();
    http.expectOne(`${API}/rates`).flush(RATES);
    fixture.detectChanges();

    pos.setTip(false);
    pos.addProduct(PRODUCTS[0]);

    // 30 USD se ven como Bs 28.500,00 (personalizada 950) y esos bolívares, al
    // cambio del BCV (876,7976), son 32,50 USD: eso cobra el cajero.
    expect(pos.chargeAmount).toBe(32.5);
    // Pagando en bolívares el cliente entrega el precio de la pantalla, tal cual.
    pos.charge.currency = 'VES';
    expect(pos.chargeAmount).toBe(28500);
    // La tarjeta de cobro no repite la conversión: el monto se lee en el campo y
    // en el resumen "Se cobrará", sin la línea "≈ Bs … al cambio".
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent as string).not.toContain('al cambio');
    expect(fixture.nativeElement.textContent as string).not.toContain(
      '= $ 32.50 · Bs 28,500.00 · tasa BCV',
    );

    pos.charge.currency = 'USD';

    pos.submitSale(true);
    fixture.detectChanges();

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
    });
    payRequest.flush(
      order({ total: 30, paidAmount: 32.5, paymentStatus: 'PAID', status: 'COMPLETED' }),
    );

    expect(pos.saving()).toBeFalse();
    flushReload();
  });

  /**
   * El cobro en efectivo se pide y se valida en la MONEDA DEL COBRO: si el cajero
   * ve los precios en bolívares, los billetes que recibe siguen siendo los de la
   * moneda elegida al cobrar (dólares por defecto) y el vuelto se calcula en ella.
   */
  it('valida el efectivo recibido en la moneda del cobro, no en la de los precios', () => {
    const { pos } = mount();
    // El cajero mira los precios en bolívares (Configuración → Cajero): el
    // formateo de montos cambia, el cobro sigue en su moneda.
    setDisplayCurrency({
      code: 'VES',
      label: 'Bolívares',
      symbol: 'Bs',
      decimals: 2,
      bsPerUnit: 1,
      bsPerUsd: 905,
    });

    pos.setTip(false);
    pos.addProduct(PRODUCTS[0]);

    expect(pos.charge.currency).toBe('USD');
    expect(pos.chargeAmount).toBe(30);

    // Con $ 10 en la mano no alcanza: la comparación es en dólares, no en Bs.
    pos.charge.received = 10;
    pos.submitSale(true);

    expect(pos.formError()).toContain('menor al total a cobrar');
    expect(pos.saving()).toBeFalse();

    // El vuelto también va en la moneda del cobro.
    pos.charge.received = 40;
    expect(pos.change).toBe(10);
  });

  it('no aplica propina nueva al agregar productos a un pedido abierto', () => {
    const { fixture, pos } = mount();

    pos.startAddToOrder(order());
    fixture.detectChanges();

    expect(pos.targetOrder()?.code).toBe('PED-0001');
    expect(pos.tipAmount).toBe(0);

    pos.addProduct(PRODUCTS[0]);
    pos.submitSale(true);
    fixture.detectChanges();

    const addRequest = http.expectOne(
      (request) => request.method === 'POST' && request.url === `${API}/orders/o1/items`,
    );
    expect(addRequest.request.body.items).toEqual([
      { productId: 'p1', quantity: 1, unitPrice: 30 },
    ]);

    // El pedido ya trae su propina: el cobro es el saldo del pedido.
    addRequest.flush(order({ subtotal: 130, tip: 10, total: 140, paidAmount: 0 }));

    const payRequest = http.expectOne(`${API}/orders/o1/payments`);
    expect(payRequest.request.body.amount).toBe(140);
    payRequest.flush(order({ total: 140, paidAmount: 140, paymentStatus: 'PAID' }));

    flushReload();
  });

  it('suma el delivery de un pedido a domicilio al total y lo envía al cobrar', () => {
    const { fixture, pos } = mount();

    pos.addProduct(PRODUCTS[0]);
    pos.setTip(false);
    pos.form.type = 'DELIVERY';
    pos.form.deliveryFee = 4;
    fixture.detectChanges();

    // 30 de la venta + 4 de delivery (sin IGV ni propina).
    expect(pos.deliveryFeeAmount).toBe(4);
    expect(pos.total).toBe(34);
    expect(pos.bill.deliveryFee).toBe(4);
    expect(pos.bill.total).toBe(34);
    expect(pos.chargeAmount).toBe(34);
    expect(fixture.nativeElement.textContent as string).toContain('Delivery');

    pos.submitSale(true);

    const createRequest = http.expectOne(
      (request) => request.method === 'POST' && request.url === `${API}/orders`,
    );
    expect(createRequest.request.body.deliveryFee).toBe(4);
    expect(createRequest.request.body.deliveryFeeCurrency).toBe('USD');

    createRequest.flush(order({ type: 'DELIVERY', deliveryFee: 4, total: 34 }));

    const payRequest = http.expectOne(`${API}/orders/o1/payments`);
    expect(payRequest.request.body.amount).toBe(34);
    payRequest.flush(
      order({ type: 'DELIVERY', deliveryFee: 4, total: 34, paymentStatus: 'PAID' }),
    );

    flushReload();
  });

  it('ignora el costo de delivery escrito si el pedido no es a domicilio', () => {
    const { fixture, pos } = mount();

    pos.addProduct(PRODUCTS[0]);
    pos.setTip(false);
    // El cajero escribió un costo pero el pedido es de salón: no se cobra.
    pos.form.deliveryFee = 4;
    fixture.detectChanges();

    expect(pos.deliveryFeeAmount).toBe(0);
    expect(pos.total).toBe(30);
    expect(pos.bill.deliveryFee).toBe(0);

    pos.submitSale(true);

    const createRequest = http.expectOne(
      (request) => request.method === 'POST' && request.url === `${API}/orders`,
    );
    expect(createRequest.request.body.deliveryFee).toBeUndefined();

    createRequest.flush(order({ total: 30 }));

    const payRequest = http.expectOne(`${API}/orders/o1/payments`);
    payRequest.flush(order({ total: 30, paymentStatus: 'PAID' }));

    flushReload();
  });

  it('conserva el delivery del pedido de la mesa al agregar productos', () => {
    const { fixture, pos } = mount();

    pos.startAddToOrder(order({ deliveryFee: 5, total: 105 }));
    fixture.detectChanges();

    // El costo del formulario no aplica sobre una mesa: manda el del pedido.
    expect(pos.deliveryFeeAmount).toBe(0);

    pos.addProduct(PRODUCTS[0]);
    fixture.detectChanges();

    // 100 del pedido + 30 nuevos + 5 de delivery guardado en el pedido.
    expect(pos.bill.deliveryFee).toBe(5);
    expect(pos.bill.total).toBe(135);

    pos.submitSale(true);

    const addRequest = http.expectOne(
      (request) => request.method === 'POST' && request.url === `${API}/orders/o1/items`,
    );
    addRequest.flush(order({ subtotal: 130, deliveryFee: 5, total: 135 }));

    const payRequest = http.expectOne(`${API}/orders/o1/payments`);
    expect(payRequest.request.body.amount).toBe(135);
    payRequest.flush(order({ total: 135, paidAmount: 135, paymentStatus: 'PAID' }));

    flushReload();
  });

  it('lista los productos de la mesa con su subtotal, total y propina al agregar o cobrar', () => {
    const { fixture, pos } = mount();

    const items: OrderItem[] = [
      {
        id: 'i1',
        orderId: 'o9',
        productId: 'p1',
        name: 'Cafe pasado',
        quantity: 2,
        unitPrice: 30,
        total: 60,
      },
      {
        id: 'i2',
        orderId: 'o9',
        productId: 'p2',
        name: 'Malta (caja 24)',
        quantity: 24,
        unitPrice: 1,
        total: 24,
      },
    ];
    const tableOrder = order({
      id: 'o9',
      code: 'PED-0009',
      tableNumber: '4',
      items,
      subtotal: 84,
      tax: 0,
      tip: 6,
      total: 90,
      paidAmount: 40,
      paymentStatus: 'PARTIAL',
    });

    pos.startAddToOrder(tableOrder);
    fixture.detectChanges();

    // Los productos de la mesa salen en el listado, no solo en un aviso.
    expect(pos.targetOrder()?.code).toBe('PED-0009');
    let text = fixture.nativeElement.textContent as string;
    expect(text).toContain('Ya en la mesa');
    expect(text).toContain('Cafe pasado');
    expect(text).toContain('Malta (caja 24)');

    // Cada línea de la mesa dice cuántas unidades se pidieron, no solo el monto.
    expect(countOf(text, 'Cantidad: 2')).toBe(1);
    expect(countOf(text, 'Cantidad: 24')).toBe(1);

    // Se ve cuántas unidades de cada producto se pidieron ya en la mesa (grilla).
    expect(pos.orderedUnitsOf('p1')).toBe(2);
    expect(pos.orderedUnitsOf('p2')).toBe(24);
    expect(pos.orderedUnitsOf('p3')).toBe(0);
    expect(text).toContain('Ya en la mesa: 2');
    expect(text).toContain('Ya en la mesa: 24');
    expect(countOf(text, 'Ya en la mesa: 2')).toBe(1);

    // Subtotal, total, propina y saldo del pedido entran en la cuenta del carrito.
    expect(pos.bill.subtotal).toBe(84);
    expect(pos.bill.tip).toBe(6);
    expect(pos.bill.total).toBe(90);
    expect(pos.bill.paid).toBe(40);
    expect(pos.bill.balance).toBe(50);
    expect(pos.chargeAmount).toBe(50);
    expect(text).toContain('Propina');
    expect(text).toContain('Saldo pendiente');

    // La línea nueva se suma a la cuenta del pedido (no la reemplaza) y a cobrar.
    pos.addProduct(PRODUCTS[0]);
    fixture.detectChanges();

    expect(pos.bill.subtotal).toBe(114);
    expect(pos.bill.total).toBe(120);
    expect(pos.bill.balance).toBe(80);
    expect(pos.chargeAmount).toBe(80);

    // La línea nueva recuerda cuántas unidades de ese producto ya pidió la mesa.
    text = fixture.nativeElement.textContent as string;
    expect(text).toContain('Por agregar');
    expect(countOf(text, 'Ya en la mesa: 2')).toBe(2);
    // La línea de la mesa sigue mostrando su propia cantidad después de agregar.
    expect(countOf(text, 'Cantidad: 2')).toBe(1);

    // El modo «cobrar» de la mesa muestra la misma cuenta con sus productos.
    pos.cancelAddMode();
    flushReload();
    pos.startChargeOrder(tableOrder);
    fixture.detectChanges();

    expect(pos.targetOrder()?.code).toBe('PED-0009');
    expect(pos.bill.total).toBe(90);
    text = fixture.nativeElement.textContent as string;
    expect(text).toContain('Ya en la mesa');
    expect(text).toContain('Cafe pasado');
  });

  /**
   * Carta de menús: el cajero vende el plato con su precio y la línea viaja al
   * backend como `menuId`, que es quien expande la receta y descuenta el stock.
   */
  it('vende un menú de la carta usando su precio y su disponibilidad', () => {
    const { fixture, pos } = mount(MENUS);
    fixture.detectChanges();

    // La grilla de la carta solo muestra los menús disponibles.
    expect(pos.filteredMenus.map((menu) => menu.name)).toEqual(['Parrilla']);

    pos.addMenu(MENUS[0]);
    fixture.detectChanges();

    const line = pos.lines()[0];
    expect(line.menuId).toBe('m1');
    expect(line.productId).toBeNull();
    expect(line.unitPrice).toBe(18);
    expect(line.ingredientCount).toBe(1);
    // `maxServings` (5) es el tope de porciones que permite el inventario.
    expect(line.stock).toBe(5);
    expect(pos.subtotal).toBe(18);
    expect(pos.lineKey(line)).toBe('m:m1');

    // Volver a tocar el plato suma una porción en la misma línea.
    pos.addMenu(MENUS[0]);
    expect(pos.lines().length).toBe(1);
    expect(pos.lines()[0].quantity).toBe(2);
    expect(pos.subtotal).toBe(36);

    // Un menú agotado no se puede agregar y avisa por qué.
    pos.addMenu(MENUS[1]);
    expect(pos.lines().length).toBe(1);
    expect(pos.formError()).toContain('no tiene stock suficiente');

    // Quitar la línea usa la clave del menú (no un `productId`).
    pos.removeLine('m:m1');
    expect(pos.lines().length).toBe(0);
  });

  /**
   * Un menú con un ingrediente desactivado no se puede vender: el POS lo rotula
   * como "Inactivo" y explica el motivo, en vez de decir que está agotado.
   */
  it('bloquea un menú cuya receta usa un producto inactivo', () => {
    const { fixture, pos } = mount(MENUS);
    fixture.detectChanges();

    // La grilla del cajero solo ofrece la carta disponible.
    expect(pos.filteredMenus.map((menu) => menu.name)).toEqual(['Parrilla']);
    expect(pos.menuStockLabel(MENUS[2])).toBe('Inactivo');
    expect(pos.menuTitle(MENUS[2])).toContain('Insumo viejo');

    pos.addMenu(MENUS[2]);

    expect(pos.lines().length).toBe(0);
    expect(pos.formError()).toContain('ingrediente inactivo');
  });

  /**
   * Precio de la unidad suelta cargado a mano en bolívares: el catálogo guarda el
   * equivalente en USD redondeado a centavos (Bs 350,00 a 970 son $ 0,36) y el
   * POS mostraba Bs 349,20. La venta sigue cobrando el valor guardado.
   */
  it('muestra el precio suelto cargado a mano, no el redondeo en dólares', () => {
    setDisplayCurrency({
      code: 'VES',
      label: 'Bolívares',
      symbol: 'Bs',
      decimals: 2,
      bsPerUnit: 1,
      bsPerUsd: 970,
    });
    const caja: ProductOption = {
      ...PRODUCTS[1],
      price: 1,
      priceEntered: 970,
      priceCurrency: 'VES',
      priceRateKey: 'BCV_USD',
      unitPrice: 0.36,
      unitPriceEntered: 350,
      unitPriceCurrency: 'VES',
      unitPriceRateKey: 'BCV_USD',
    };
    const { pos } = mount();

    expect(pos.looseUnitPriceText(caja)).toBe('Bs 350.00');
    expect(pos.boxPriceText(caja)).toBe('Bs 970.00');
    // El precio guardado reconvertido es el número que se veía mal.
    expect(money(unitPriceOf(caja))).toBe('Bs 349.20');

    // Un producto cargado en dólares sigue mostrando su conversión.
    expect(pos.looseUnitPriceText(PRODUCTS[1])).toBe('Bs 970.00');
    expect(pos.boxPriceText(PRODUCTS[1])).toBe('Bs 23,280.00');
  });

  /**
   * El buscador es global: recorre productos y menús sin importar la pestaña
   * activa, y mira nombre, SKU/código, descripción, categoría e ingredientes.
   */
  it('busca en productos y menús por categoría, descripción e ingredientes', () => {
    const { fixture, pos } = mount(MENUS);
    const bebidas: Category = {
      id: 'cat-bebidas',
      name: 'Bebidas',
      active: true,
      createdAt: '2026-10-13T10:00:00.000Z',
      updatedAt: '2026-10-13T10:00:00.000Z',
    };
    const agua: ProductOption = {
      id: 'p3',
      sku: 'AGUA-01',
      name: 'Agua mineral',
      description: 'Botella de 625 ml',
      price: 2,
      stock: 12,
      unit: 'UND',
      unitsPerBox: 1,
      categoryId: bebidas.id,
    };
    pos.products.set([...PRODUCTS, agua]);
    pos.categories.set([bebidas]);

    // Producto por categoría, aunque la pestaña activa sea la de productos.
    pos.search = 'bebidas';
    fixture.detectChanges();
    expect(pos.catalogRows.map((row) => row.name)).toEqual(['Agua mineral']);

    // Menú por el nombre de un ingrediente de su receta: «carne» → Parrilla.
    pos.search = 'carne';
    fixture.detectChanges();
    expect(pos.catalogRows.map((row) => row.name)).toEqual(['Parrilla']);

    // El SKU sigue funcionando sin importar tildes ni mayúsculas.
    pos.search = 'agua-01';
    fixture.detectChanges();
    expect(pos.catalogRows.map((row) => row.name)).toEqual(['Agua mineral']);
  });

  /**
   * Las tarjetas se pensaron para mostrar mucho catálogo de un vistazo: 4
   * columnas desde 600 px y 6 en escritorio, con piezas compactas (foto de
   * 5rem, textos pequeños y separación reducida).
   */
  it('muestra las tarjetas compactas con 4 columnas en 601 px y 6 en escritorio', () => {
    const { fixture } = mount();

    expect(localStorage.getItem('nexo-hub.pos-view')).toBeNull();
    const grid = fixture.nativeElement.querySelector('[data-pos-cards]') as HTMLElement | null;
    expect(grid).not.toBeNull();
    expect(grid!.classList.contains('md:grid-cols-6')).toBeTrue();
    expect(grid!.classList.contains('md:grid-cols-5')).toBeFalse();
    // En una pantalla de 601 px se ven 4 columnas (antes se veían 2).
    expect(grid!.classList.contains('min-[600px]:grid-cols-4')).toBeTrue();
    expect(grid!.classList.contains('sm:grid-cols-3')).toBeFalse();
    expect(grid!.classList.contains('gap-2')).toBeTrue();
    expect(grid!.classList.contains('p-2')).toBeTrue();
    expect(grid!.classList.contains('[scrollbar-gutter:stable]')).toBeTrue();

    // El ancho no debe cambiar entre «todo el catálogo» y «filtrado», y los
    // textos completos deben poder envolverse en vez de recortarse.
    const name = grid!.querySelector('[data-pos-card-name]') as HTMLElement | null;
    expect(name).not.toBeNull();
    expect(name!.classList.contains('line-clamp-2')).toBeFalse();
    expect(name!.classList.contains('break-words')).toBeTrue();

    const code = grid!.querySelector('[data-pos-card-code]') as HTMLElement | null;
    expect(code).not.toBeNull();
    expect(code!.classList.contains('truncate')).toBeFalse();
    expect(code!.classList.contains('break-words')).toBeTrue();

    const price = grid!.querySelector('[data-pos-card-price]') as HTMLElement | null;
    expect(price).not.toBeNull();
    expect(price!.classList.contains('break-words')).toBeTrue();

    const image = grid!.querySelector('[data-pos-card-image]') as HTMLElement | null;
    expect(image).not.toBeNull();
    expect(image!.classList.contains('h-20')).toBeTrue();
    expect(image!.classList.contains('h-24')).toBeFalse();
  });

  /**
   * Con el catálogo completo la barra de desplazamiento aparecía y estrechaba las
   * tarjetas; al filtrar desaparecía y los textos ya entraban. Ahora el ancho se
   * reserva siempre y, además, nombres/códigos/precios pueden ocupar varias
   * líneas en las vistas de tarjetas, columnas y tabla.
   */
  it('no recorta nombres, códigos ni precios en las tres vistas del catálogo', () => {
    localStorage.setItem('nexo-hub.pos-view', 'columns');
    const columnsFixture = mount().fixture;
    const scroll = columnsFixture.nativeElement.querySelector(
      '[data-pos-cards], [style*="grid-auto-flow: column"]',
    ) as HTMLElement | null;
    expect(scroll).not.toBeNull();
    expect(scroll!.parentElement!.classList.contains('[scrollbar-gutter:stable]')).toBeTrue();

    const columnName = columnsFixture.nativeElement.querySelector(
      '[data-pos-column-name]',
    ) as HTMLElement | null;
    expect(columnName).not.toBeNull();
    expect(columnName!.classList.contains('truncate')).toBeFalse();
    expect(columnName!.classList.contains('break-words')).toBeTrue();

    const columnCode = columnsFixture.nativeElement.querySelector(
      '[data-pos-column-code]',
    ) as HTMLElement | null;
    expect(columnCode!.classList.contains('truncate')).toBeFalse();
    expect(columnCode!.classList.contains('break-words')).toBeTrue();

    const columnPrice = columnsFixture.nativeElement.querySelector(
      '[data-pos-column-price]',
    ) as HTMLElement | null;
    expect(columnPrice!.classList.contains('break-words')).toBeTrue();
    columnsFixture.destroy();
  });

  /**
   * La vista de tabla pagina de 20 en 20 y la de columnas agrupa 10 filas por
   * columna, sin fotos: son las dos presentaciones que elige el admin.
   */
  it('pagina la tabla de 20 en 20 y arma columnas de 10 sin fotos', () => {
    localStorage.setItem('nexo-hub.pos-view', 'columns');
    const { fixture, pos } = mount();
    const products = Array.from({ length: 25 }, (_, index) => ({
      ...PRODUCTS[0],
      id: `p-${index}`,
      sku: `SKU-${index}`,
      name: `Producto ${index + 1}`,
    }));
    pos.products.set(products);
    fixture.detectChanges();

    expect(pos.posView()).toBe('columns');
    const columns = fixture.nativeElement.querySelector(
      '[style*="grid-auto-flow: column"]',
    ) as HTMLElement | null;
    expect(columns).not.toBeNull();
    expect(columns!.querySelectorAll('img')).toHaveSize(0);
    expect(pos.catalogRows.length).toBe(25);

    expect(pos.pagedCatalogRows.length).toBe(20);
    pos.nextTablePage();
    expect(pos.currentTablePage).toBe(2);
    expect(pos.pagedCatalogRows.length).toBe(5);
  });

  it('pinta la tabla con 20 filas por página cuando el admin la elige', () => {
    localStorage.setItem('nexo-hub.pos-view', 'table');
    const { fixture, pos } = mount();
    const products = Array.from({ length: 25 }, (_, index) => ({
      ...PRODUCTS[0],
      id: `p-${index}`,
      sku: `SKU-${index}`,
      name: `Producto ${index + 1}`,
    }));
    pos.products.set(products);
    fixture.detectChanges();

    const table = fixture.nativeElement.querySelector('table') as HTMLTableElement | null;
    expect(table).not.toBeNull();
    expect(table!.querySelectorAll('tbody tr').length).toBe(20);
    expect(fixture.nativeElement.textContent).toContain('Página 1 de 2');

    const tableName = table!.querySelector('[data-pos-table-name]') as HTMLElement | null;
    expect(tableName).not.toBeNull();
    expect(tableName!.classList.contains('truncate')).toBeFalse();
    expect(tableName!.classList.contains('break-words')).toBeTrue();
    expect(table!.parentElement!.classList.contains('[scrollbar-gutter:stable]')).toBeTrue();
  });
});

/** Cuenta cuantas veces aparece un texto completo en el contenido renderizado. */
function countOf(text: string, token: string): number {
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return (text.match(new RegExp(`${escaped}\\b`, 'g')) ?? []).length;
}
