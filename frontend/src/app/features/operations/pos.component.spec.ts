import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { environment } from '../../../environments/environment';
import type { ProductOption } from '../../core/models/api.model';
import type { MenuOption } from '../../core/models/api.model';
import type { Order, OrderItem } from '../../core/models/operations.model';
import { PosComponent } from './pos.component';

const API = environment.apiUrl;

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
    ingredients: [
      {
        quantity: 0.1,
        product: { id: 'p1', name: 'Carne', unit: 'KG', stock: 0.5, trackStock: true },
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
    ingredients: [],
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
  });

  function mount(menus: MenuOption[] = []): {
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

  it('vende la unidad suelta de un producto por caja al precio repartido', () => {
    const { fixture, pos } = mount();

    pos.addProduct(PRODUCTS[1]);
    fixture.detectChanges();

    expect(pos.lines()[0].unitPrice).toBe(1);
    expect(pos.subtotal).toBe(1);

    // La caja completa suma sus 24 unidades a la misma linea.
    pos.addBox(PRODUCTS[1]);
    expect(pos.lines()[0].quantity).toBe(25);
    expect(pos.subtotal).toBe(25);
  });

  it('arranca con la propina sugerida (10 %) y la aplica sobre el neto', () => {
    const { fixture, pos } = mount();

    expect(pos.form.tipRate).toBe(10);
    expect(pos.tipAmount).toBe(0);

    pos.addProduct(PRODUCTS[0]);
    fixture.detectChanges();

    expect(pos.subtotal).toBe(30);
    expect(pos.tipAmount).toBe(3);
    expect(pos.total).toBe(33);

    // La propina es opcional y no paga IGV: con 18 % de IGV el total es 30 + 5.4.
    pos.form.taxRate = 18;
    pos.setTipRate(0);
    fixture.detectChanges();

    expect(pos.tipAmount).toBe(0);
    expect(pos.total).toBe(35.4);
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
});

/** Cuenta cuantas veces aparece un texto completo en el contenido renderizado. */
function countOf(text: string, token: string): number {
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return (text.match(new RegExp(`${escaped}\\b`, 'g')) ?? []).length;
}
