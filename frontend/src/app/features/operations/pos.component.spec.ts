import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { environment } from '../../../environments/environment';
import type { ProductOption } from '../../core/models/api.model';
import type { Order } from '../../core/models/operations.model';
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

  function mount(): { fixture: ComponentFixture<PosComponent>; pos: PosComponent } {
    const fixture = TestBed.createComponent(PosComponent);
    const pos = fixture.componentInstance;
    fixture.detectChanges();

    http.expectOne(`${API}/products/options`).flush(PRODUCTS);
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
});
