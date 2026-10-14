import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { environment } from '../../../environments/environment';
import type { ProductOption } from '../../core/models/api.model';
import type { MenuOption } from '../../core/models/api.model';
import type { Order, OrderItem } from '../../core/models/operations.model';
import { money, setDisplayCurrency } from '../../core/utils/format';
import { unitPriceOf } from '../../core/utils/product-pricing';
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

    pos.setTipRate(0);
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

    pos.setTipRate(0);
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

  it('suma el delivery de un pedido a domicilio al total y lo envía al cobrar', () => {
    const { fixture, pos } = mount();

    pos.addProduct(PRODUCTS[0]);
    pos.setTipRate(0);
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
    pos.setTipRate(0);
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
});

/** Cuenta cuantas veces aparece un texto completo en el contenido renderizado. */
function countOf(text: string, token: string): number {
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return (text.match(new RegExp(`${escaped}\\b`, 'g')) ?? []).length;
}
