import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';
import { environment } from '../../../environments/environment';
import type { PaginationMeta, Product } from '../../core/models/api.model';
import { setDisplayCurrency } from '../../core/utils/format';
import { ToastService } from '../../core/services/toast.service';
import { ConfirmService } from '../../shared/services/confirm.service';
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
    priceCurrency: 'USD',
    priceRate: 900,
    priceEntered: null,
    cost: 1,
    costCurrency: 'USD',
    costRate: 900,
    costEntered: null,
    unitCost: 1,
    unitCostEntered: null,
    unitCostCurrency: 'USD',
    unitPrice: 0,
    unitPriceEntered: null,
    unitPriceCurrency: 'USD',
    stock: 10,
    minStock: 2,
    unit: 'UND',
    unitsPerBox: 1,
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

  afterEach(() => {
    // La moneda de visualización es estado global de `format.ts`.
    setDisplayCurrency(null);
    http.verify();
  });

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

  /**
   * Elige una unidad en el select del formulario, como lo hace el operador: se
   * busca la opcion por su texto visible ("Caja", "Unidad"...). Se dispara la
   * salida `ngModelChange` del select en lugar de un evento `change` del DOM
   * porque el formulario vive dentro del contenido proyectado del modal y su
   * `NgModel` no se sincroniza en las pruebas hasta que el modal se vuelve a
   * revisar (en el navegador lo hace el primer clic del operador).
   */
  function selectUnit(fixture: ComponentFixture<ProductsPage>, label: string): void {
    const select = fixture.nativeElement.querySelector('#prod-unit') as HTMLSelectElement;
    const option = Array.from(select.options).find(
      (candidate) => (candidate.textContent ?? '').trim() === label,
    );
    if (!option) throw new Error(`No se encontro la unidad ${label}`);
    fixture.debugElement
      .query(By.css('#prod-unit'))
      .triggerEventHandler('ngModelChange', option.value);
    fixture.detectChanges();
  }

  /** `true` cuando el formulario muestra el campo de unidades de la presentacion. */
  function hasPackUnitsField(fixture: ComponentFixture<ProductsPage>): boolean {
    return !!fixture.nativeElement.querySelector('#prod-units-per-box');
  }

  /**
   * Escribe las unidades por caja como lo hace el operador: se dispara la salida
   * `ngModelChange` del input (mismo motivo que en `selectUnit`: el formulario vive
   * en el contenido proyectado del modal).
   */
  function setUnitsPerBox(fixture: ComponentFixture<ProductsPage>, units: number): void {
    fixture.debugElement
      .query(By.css('#prod-units-per-box'))
      .triggerEventHandler('ngModelChange', units);
    fixture.detectChanges();
  }

  /** `true` cuando el formulario muestra el precio de venta de la unidad suelta. */
  function hasUnitPriceField(fixture: ComponentFixture<ProductsPage>): boolean {
    return !!fixture.nativeElement.querySelector('#prod-unit-price');
  }

  /** Resuelve la recarga del catalogo que dispara la pagina tras guardar. */
  function expectReload(items: Product[]): void {
    http
      .expectOne((request) => request.method === 'GET' && request.url === `${API}/products`)
      .flush({ items, meta: { ...META, total: items.length } });
  }

  it('etiqueta el precio y el costo con su moneda (USD por defecto), no en soles', () => {
    const fixture = mount();
    const page = fixture.componentInstance;

    page.openCreate();
    fixture.detectChanges();

    expect(page.baseCurrency.code).toBe('USD');
    expect(page.form.priceCurrency).toBe('USD');
    expect(labelText(fixture.nativeElement, 'prod-price')).toBe('Precio de venta *');
    expect(labelText(fixture.nativeElement, 'prod-cost')).toBe(
      'Costo de la presentación',
    );
    expect(fixture.nativeElement.textContent).not.toContain('PEN');
  });

  it('mantiene la moneda con la que se cargo el precio al editar', () => {
    const item = product({
      price: 12.5,
      cost: 8,
      // Cargado en bolivares: el formulario recupera lo que se escribio.
      priceCurrency: 'VES',
      priceEntered: 11250,
      costCurrency: 'VES',
      costEntered: 7200,
    });
    const fixture = mount([item]);
    const page = fixture.componentInstance;

    page.openEdit(item);
    fixture.detectChanges();

    expect(page.form.price).toBe(11250);
    expect(page.form.priceCurrency).toBe('VES');
    expect(page.form.cost).toBe(7200);
    expect(page.form.costCurrency).toBe('VES');
  });

  /**
   * Bug del precio por unidad suelta: se guarda en USD redondeado a centavos, así
   * que Bs 350,00 a 970 Bs por dólar son $ 0,36 y al volver a bolívares daba
   * Bs 349,20. La lista debe recuperar el monto que escribió el operador.
   */
  it('muestra en la lista los montos cargados a mano, no el redondeo en dólares', () => {
    setDisplayCurrency({
      code: 'VES',
      label: 'Bolívares',
      symbol: 'Bs',
      decimals: 2,
      bsPerUnit: 1,
      bsPerUsd: 970,
    });
    const item = product({
      name: 'Malta (caja 24)',
      price: 1,
      priceCurrency: 'VES',
      priceEntered: 970,
      priceRateKey: 'BCV_USD',
      unit: 'CAJA',
      unitsPerBox: 24,
      unitPrice: 0.36,
      unitPriceEntered: 350,
      unitPriceCurrency: 'VES',
      unitPriceRateKey: 'BCV_USD',
    });
    const fixture = mount([item]);

    const text = fixture.nativeElement.textContent as string;

    // La presentación se escribió a Bs 970,00 y la unidad suelta a Bs 350,00.
    expect(text).toContain('Bs 970.00');
    expect(text).toContain('Bs 350.00');
    // El equivalente guardado (0,36 USD) reconvertido es el número equivocado.
    expect(text).not.toContain('349.20');
  });

  it('configura las unidades por caja de la presentacion y muestra el precio suelto', () => {
    const item = product({ name: 'Malta (caja 24)', price: 24, stock: 48, unit: 'CAJA', unitsPerBox: 24 });
    const fixture = mount([item]);
    const page = fixture.componentInstance;

    page.openEdit(item);
    fixture.detectChanges();

    expect(page.form.unitsPerBox).toBe(24);
    expect(page.isBoxForm).toBe(true);
    // La caja de $ 24 trae 24 unidades: cada una se vende a $ 1.
    expect(page.boxPreview).toEqual({
      units: 24,
      unitLabel: 'Caja',
      unitPrice: 1,
      currency: 'USD',
    });
    expect(labelText(fixture.nativeElement, 'prod-units-per-box')).toBe('Unidades por caja');
    expect(labelText(fixture.nativeElement, 'prod-unit-price')).toBe(
      'Precio de venta unitario (por unidad suelta)',
    );

    page.save();
    const request = http.expectOne(
      (candidate) => candidate.method === 'PATCH' && candidate.url === `${API}/products/p1`,
    );
    expect(request.request.body.unitsPerBox).toBe(24);
    // El precio unitario viaja con la caja (sin definirlo se reparte el precio).
    expect(request.request.body.unitPrice).toBe(0);
    expect(request.request.body.priceCurrency).toBe('USD');
    request.flush(item);
    expectReload([item]);
  });

  it('solo pide las unidades por caja cuando la unidad es una presentacion', () => {
    const fixture = mount([]);
    const page = fixture.componentInstance;

    page.openCreate();
    fixture.detectChanges();

    // La unidad por defecto es la suelta: no hay presentacion que configurar.
    expect(page.form.unit).toBe('UND');
    expect(hasPackUnitsField(fixture)).toBe(false);
    expect(hasUnitPriceField(fixture)).toBe(false);

    selectUnit(fixture, 'Caja');
    expect(hasPackUnitsField(fixture)).toBe(true);
    // Con una sola unidad por caja no hay precio unitario que definir.
    expect(hasUnitPriceField(fixture)).toBe(false);
    expect(labelText(fixture.nativeElement, 'prod-units-per-box')).toBe('Unidades por caja');

    setUnitsPerBox(fixture, 12);
    expect(hasUnitPriceField(fixture)).toBe(true);

    selectUnit(fixture, 'Paquete');
    expect(labelText(fixture.nativeElement, 'prod-units-per-box')).toBe('Unidades por paquete');

    selectUnit(fixture, 'Kilogramo');
    expect(hasPackUnitsField(fixture)).toBe(false);
    expect(hasUnitPriceField(fixture)).toBe(false);
  });

  it('limpia las unidades por caja al cambiar a una unidad que no es presentacion', () => {
    const item = product({ name: 'Malta (caja 24)', price: 24, unit: 'CAJA', unitsPerBox: 24 });
    const fixture = mount([item]);
    const page = fixture.componentInstance;

    page.openEdit(item);
    fixture.detectChanges();
    expect(page.form.unitsPerBox).toBe(24);

    selectUnit(fixture, 'Unidad');

    expect(page.form.unit).toBe('UND');
    expect(page.form.unitsPerBox).toBe(1);
    expect(page.isBoxForm).toBe(false);
    expect(hasPackUnitsField(fixture)).toBe(false);

    page.save();
    const request = http.expectOne(
      (candidate) => candidate.method === 'PATCH' && candidate.url === `${API}/products/p1`,
    );
    expect(request.request.body.unit).toBe('UND');
    expect(request.request.body.unitsPerBox).toBe(1);
    // Sin presentacion el precio unitario queda en 0 (sin definir).
    expect(request.request.body.unitPrice).toBe(0);
    request.flush(item);
    expectReload([item]);
  });

  it('deja corregir la presentacion de un producto guardado con unidad suelta', () => {
    const item = product({ name: 'Agua (caja 24)', price: 72, unit: 'UND', unitsPerBox: 24 });
    const fixture = mount([item]);
    const page = fixture.componentInstance;

    page.openEdit(item);
    fixture.detectChanges();

    // El dato ya esta guardado: el campo se muestra para poder corregirlo.
    expect(hasPackUnitsField(fixture)).toBe(true);
    expect(page.isBoxForm).toBe(true);
  });

  it('no pisa los montos: el precio de la presentacion y el unitario van por separado', () => {
    const item = product({
      name: 'Malta (caja 24)',
      price: 24,
      cost: 1,
      unitPrice: 3.5,
      unit: 'CAJA',
      unitsPerBox: 24,
    });
    const fixture = mount([item]);
    const page = fixture.componentInstance;

    page.openEdit(item);
    fixture.detectChanges();

    // El precio unitario del catalogo se recupera tal cual ($ 3.50, no el $ 1 que
    // saldria de repartir la caja).
    expect(page.form.unitPrice).toBe(3.5);
    expect(page.boxPreview?.unitPrice).toBe(3.5);

    page.form.price = 48;

    expect(page.form.price).toBe(48);
    // El unitario se queda como estaba: el que decide es el operador.
    expect(page.form.unitPrice).toBe(3.5);
    // El reparto se muestra como referencia de lectura, no se escribe solo.
    expect(page.unitPriceReference).toEqual({ amount: 2, units: 24, currency: 'USD' });

    page.onUnitPriceChange(1.5);

    expect(page.form.unitPrice).toBe(1.5);
    // Tampoco se recalcula la caja al escribir el unitario.
    expect(page.form.price).toBe(48);

    page.save();
    const request = http.expectOne(
      (candidate) => candidate.method === 'PATCH' && candidate.url === `${API}/products/p1`,
    );
    // Los dos montos viajan tal cual se escribieron.
    expect(request.request.body.price).toBe(48);
    expect(request.request.body.unitPrice).toBe(1.5);
    request.flush(item);
    expectReload([item]);
  });

  it('no arrastra la moneda de un monto al otro: cada campo elige la suya', () => {
    const item = product({
      name: 'Malta (caja 24)',
      price: 24,
      cost: 12,
      costCurrency: 'USD',
      costEntered: 12,
      unitPrice: 0.5,
      unitPriceEntered: 450,
      unitPriceCurrency: 'VES',
      unit: 'CAJA',
      unitsPerBox: 24,
    });
    const fixture = mount([item]);
    const page = fixture.componentInstance;

    page.openEdit(item);
    fixture.detectChanges();

    // Cada monto recupera SU moneda: la caja en dolares y la unidad suelta en
    // bolivares (450 Bs por unidad).
    expect(page.form.costCurrency).toBe('USD');
    expect(page.form.unitPrice).toBe(450);
    expect(page.form.unitPriceCurrency).toBe('VES');

    // Cambiar la moneda del costo de la presentacion no toca la del unitario.
    page.onCostCurrencyChange('EUR');
    expect(page.form.costCurrency).toBe('EUR');
    expect(page.form.unitPriceCurrency).toBe('VES');
    // La moneda es solo un contexto: no reinterpreta los montos ya cargados.
    expect(page.form.cost).toBe(12);
    expect(page.form.unitPrice).toBe(450);

    // Y al reves: cambiar la del unitario tampoco toca la de la presentacion.
    page.onUnitPriceCurrencyChange('USD');
    expect(page.form.unitPriceCurrency).toBe('USD');
    expect(page.form.costCurrency).toBe('EUR');

    page.save();
    const request = http.expectOne(
      (candidate) => candidate.method === 'PATCH' && candidate.url === `${API}/products/p1`,
    );
    // Las dos monedas viajan juntas, cada una con su monto.
    expect(request.request.body.cost).toBe(12);
    expect(request.request.body.costCurrency).toBe('EUR');
    expect(request.request.body.unitPrice).toBe(450);
    expect(request.request.body.unitPriceCurrency).toBe('USD');
    request.flush(item);
    expectReload([item]);
  });

  /**
   * La tasa tambien es por campo: el operador puede convertir el precio al cambio
   * del euro, la presentacion a la personalizada y la unidad suelta al BCV dolar.
   * Las tres viajan con su monto y el formulario las recupera al reabrir.
   */
  it('envia la tasa elegida de cada monto y la recupera al editar', () => {
    const item = product({
      name: 'Malta (caja 24)',
      price: 24,
      priceCurrency: 'VES',
      priceEntered: 21600,
      priceRateKey: 'BCV_EUR',
      cost: 12,
      costCurrency: 'USD',
      costEntered: 12,
      costRateKey: 'CUSTOM_USD',
      unitPrice: 3.5,
      unitPriceEntered: 3150,
      unitPriceCurrency: 'VES',
      unitPriceRateKey: 'BCV_USD',
      unit: 'CAJA',
      unitsPerBox: 24,
    });
    const fixture = mount([item]);
    const page = fixture.componentInstance;

    page.openEdit(item);
    fixture.detectChanges();

    expect(page.form.priceRateKey).toBe('BCV_EUR');
    expect(page.form.costRateKey).toBe('CUSTOM_USD');
    expect(page.form.unitPriceRateKey).toBe('BCV_USD');

    // Cambiar la tasa de un monto no toca la de los otros.
    page.onCostRateKeyChange('BCV_EUR');
    expect(page.form.costRateKey).toBe('BCV_EUR');
    expect(page.form.priceRateKey).toBe('BCV_EUR');
    expect(page.form.unitPriceRateKey).toBe('BCV_USD');

    page.save();
    const request = http.expectOne(
      (candidate) => candidate.method === 'PATCH' && candidate.url === `${API}/products/p1`,
    );
    expect(request.request.body.priceRateKey).toBe('BCV_EUR');
    expect(request.request.body.costRateKey).toBe('BCV_EUR');
    expect(request.request.body.unitPriceRateKey).toBe('BCV_USD');
    request.flush(item);
    expectReload([item]);
  });

  it('arranca con la tasa activa del sistema en un producto nuevo', () => {
    const fixture = mount([]);
    const page = fixture.componentInstance;

    page.openCreate();
    fixture.detectChanges();

    // Sin tasas cargadas en las pruebas, la activa es la del BCV dolar.
    expect(page.form.priceRateKey).toBe('BCV_USD');
    expect(page.form.costRateKey).toBe('BCV_USD');
    expect(page.form.unitPriceRateKey).toBe('BCV_USD');

    page.form.name = 'Agua 500 ml';
    page.form.unit = 'CAJA';
    page.form.unitsPerBox = 12;
    page.save();

    const request = http.expectOne(
      (candidate) => candidate.method === 'POST' && candidate.url === `${API}/products`,
    );
    expect(request.request.body.priceRateKey).toBe('BCV_USD');
    expect(request.request.body.costRateKey).toBe('BCV_USD');
    expect(request.request.body.unitPriceRateKey).toBe('BCV_USD');
    request.flush(product({ id: 'p4', name: 'Agua 500 ml' }));
    expectReload([]);
  });

  it('envia una unidad por caja cuando el producto se vende suelto', () => {
    const fixture = mount([]);
    const page = fixture.componentInstance;

    page.openCreate();
    fixture.detectChanges();
    page.form.name = 'Agua 500 ml';
    page.form.price = 1.5;
    page.save();

    const request = http.expectOne(
      (candidate) => candidate.method === 'POST' && candidate.url === `${API}/products`,
    );
    expect(request.request.body.unitsPerBox).toBe(1);
    request.flush(product({ id: 'p2', name: 'Agua 500 ml', price: 1.5 }));
    expectReload([]);
  });

  /**
   * Desactivar un producto no lo quita de las recetas que ya lo usan: el API
   * responde esos menús (`affectedMenus`) y la pagina avisa que quedan sin poder
   * venderse hasta reemplazar el ingrediente.
   */
  it('avisa que menús quedan sin poder venderse al desactivar un producto', async () => {
    const fixture = mount([product()]);
    const page = fixture.componentInstance;
    spyOn(TestBed.inject(ConfirmService), 'ask').and.resolveTo(true);
    const toast = TestBed.inject(ToastService);

    await page.remove(page.items()[0]);

    const request = http.expectOne(
      (candidate) =>
        candidate.method === 'DELETE' && candidate.url === `${API}/products/p1`,
    );
    request.flush({
      count: 1,
      affectedMenus: [
        { id: 'm1', code: 'MEN-0001', name: 'Parrilla' },
        { id: 'm2', code: 'MEN-0002', name: 'Combo' },
      ],
    });
    expectReload([]);

    const warning = toast
      .toasts()
      .find((notification) => notification.kind === 'warning');
    expect(warning?.title).toBe('Revisa las recetas');
    expect(warning?.message).toContain('Parrilla, Combo');
  });

  it('no avisa de menús cuando el producto no esta en ninguna receta', async () => {
    const fixture = mount([product()]);
    const page = fixture.componentInstance;
    spyOn(TestBed.inject(ConfirmService), 'ask').and.resolveTo(true);
    const toast = TestBed.inject(ToastService);

    await page.remove(page.items()[0]);

    http
      .expectOne(
        (candidate) =>
          candidate.method === 'DELETE' && candidate.url === `${API}/products/p1`,
      )
      .flush({ count: 1, affectedMenus: [] });
    expectReload([]);

    expect(toast.toasts().map((notification) => notification.kind)).toEqual([
      'success',
    ]);
  });
});
