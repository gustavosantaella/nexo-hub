import { signal } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { EMPTY, of } from 'rxjs';
import { environment } from '../../../environments/environment';
import type { Company, User } from '../../core/models/api.model';
import type { CatalogDocument, CatalogImportResult } from '../../core/models/data-transfer.model';
import type { CurrencyRateOption } from '../../core/models/rates.model';
import { AuthService } from '../../core/services/auth.service';
import { CompaniesService } from '../../core/services/companies.service';
import { CurrenciesService } from '../../core/services/currencies.service';
import { DataTransferService } from '../../core/services/data-transfer.service';
import { RatesService } from '../../core/services/rates.service';
import { ConfirmService } from '../../shared/services/confirm.service';
import { SettingsPage } from './settings.page';

/** Tema guardado por otra prueba: se limpia antes de montar la pantalla. */
const THEME_KEY = 'nexo-hub.theme';

/** Copia local en el navegador de la propina que tiene configurada la empresa. */
const TIP_PERCENT_KEY = 'nexo-hub.tip-percent';

/** Copia local en el navegador de la presentación de los formularios. */
const DIALOG_VIEW_KEY = 'nexo-hub.dialog-view';

/**
 * Copia local en el navegador de la moneda de los precios que tiene configurada
 * la empresa.
 */
const PRICE_CURRENCY_KEY = 'nexo-hub.price-currency';

/** Doble mínimo de `RatesService`: aquí solo importa la navegación por pestañas. */
const ratesStub = {
  loading: signal(false),
  snapshot: signal<unknown>(null),
  bcv: signal(null),
  custom: signal(null),
  hasCustom: signal(false),
  rates: signal([]),
  currencies: signal<CurrencyRateOption[]>([]),
  baseCurrency: signal({
    code: 'USD',
    label: 'Dólares',
    symbol: '$',
    decimals: 2,
    bsPerUnit: null,
    bsPerUsd: 0,
  }),
  baseCode: signal('USD'),
  convertsBase: signal(false),
  stale: signal(false),
  activeKey: signal(null),
  showConversions: signal(true),
  reference: signal(null),
  ensureLoaded: () => undefined,
  load: () => undefined,
  setConversions: () => undefined,
  /** Etiqueta de una moneda configurada (como el servicio real). */
  currencyLabel: (code: string) =>
    code === 'COP' ? 'Pesos colombianos (COP)' : `Dólares (${code})`,
  /** Los $ 10 de la vista previa: aquí basta con una tasa fija. */
  fromBase: jasmine
    .createSpy('fromBase')
    .and.callFake((amount: number) => Number(amount) * 3985.44),
  /** Lo llama la pantalla al guardar la moneda de los precios. */
  applyDisplayPreference: jasmine.createSpy('applyDisplayPreference'),
};

/** Doble mínimo de `AuthService` (los effects de la pantalla leen estos signals). */
const authStub = {
  canManage: signal(false),
  company: signal<Company | null>(null),
  user: signal<User | null>(null),
  refreshProfile: () => EMPTY,
  updateProfile: () => EMPTY,
  switchCompany: () => EMPTY,
};

const companiesStub = {
  current: () => EMPTY,
  updateCurrent: () => EMPTY,
  create: () => EMPTY,
};

const currenciesStub = { saving: signal(false), save: jasmine.createSpy('save') };

/**
 * Espera a que se cumpla una condición dando turnos al bucle de eventos: leer un
 * archivo y abrir el diálogo de confirmación no ocurre en el mismo turno.
 */
async function esperar(condition: () => boolean, turns = 20): Promise<void> {
  for (let turn = 0; turn < turns && !condition(); turn += 1) {
    await new Promise((resolve) => setTimeout(resolve));
  }
}

/** Respaldo mínimo del catálogo: lo que el API devuelve al exportar. */
const catalogoExportado: CatalogDocument = {
  format: 'nexo-hub.catalog',
  version: 1,
  exportedAt: '2024-05-01T12:00:00.000Z',
  company: { id: 'emp-1', name: 'Cafetería Central' },
  counts: { categories: 1, menuCategories: 0, suppliers: 0, products: 1, menus: 0 },
  categories: [{ name: 'Bebidas', active: true }],
  menuCategories: [],
  suppliers: [],
  products: [
    {
      sku: 'CAF-1',
      name: 'Café',
      price: 1,
      priceCurrency: 'USD',
      priceUsd: 1,
      stock: 5,
      minStock: 1,
      unit: 'unit',
      unitsPerBox: 1,
      trackStock: true,
      active: true,
    },
  ],
  menus: [],
};

/** Lo que devuelve el doble al importar: dos guardados y un aviso. */
const resultadoImportacion: CatalogImportResult = {
  mode: 'merge',
  created: { categories: 1, menuCategories: 0, suppliers: 0, products: 1, menus: 0 },
  updated: { categories: 0, menuCategories: 0, suppliers: 0, products: 0, menus: 0 },
  skipped: { categories: 0, menuCategories: 0, suppliers: 0, products: 0, menus: 0 },
  issues: [
    {
      entity: 'menus',
      level: 'warning',
      reference: 'MEN-1',
      message: 'No se encontró el ingrediente CAF-2.',
    },
  ],
};

/** Doble mínimo de `DataTransferService`: aquí no se sale a la red. */
const dataTransferStub = {
  exportCatalog: jasmine.createSpy('exportCatalog').and.returnValue(of(catalogoExportado)),
  importCatalog: jasmine.createSpy('importCatalog').and.returnValue(of(resultadoImportacion)),
};

/**
 * Pruebas de las pestañas de Configuración: se pinta una sola sección a la vez y
 * se puede cambiar con el ratón o con las flechas del teclado.
 */
describe('SettingsPage (pestañas de configuración)', () => {
  let fixture: ComponentFixture<SettingsPage>;

  beforeEach(async () => {
    localStorage.removeItem(THEME_KEY);
    localStorage.removeItem(TIP_PERCENT_KEY);
    localStorage.removeItem(DIALOG_VIEW_KEY);
    localStorage.removeItem(PRICE_CURRENCY_KEY);

    // Cada prueba arranca sin permiso de administración y con los dobles limpios.
    authStub.canManage.set(false);
    ratesStub.currencies.set([]);
    ratesStub.applyDisplayPreference.calls.reset();
    ratesStub.fromBase.calls.reset();
    dataTransferStub.exportCatalog.calls.reset();
    dataTransferStub.importCatalog.calls.reset();

    await TestBed.configureTestingModule({
      imports: [SettingsPage],
      providers: [
        provideRouter([]),
        // La propina y la presentación de los formularios se guardan para la
        // empresa (`PreferencesService`): aquí las peticiones quedan simuladas.
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: RatesService, useValue: ratesStub },
        { provide: AuthService, useValue: authStub },
        { provide: CompaniesService, useValue: companiesStub },
        { provide: CurrenciesService, useValue: currenciesStub },
        { provide: DataTransferService, useValue: dataTransferStub },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(SettingsPage);
    fixture.detectChanges();
  });

  afterEach(() => {
    document.documentElement.classList.remove('dark');
    localStorage.removeItem(THEME_KEY);
    localStorage.removeItem(TIP_PERCENT_KEY);
    localStorage.removeItem(DIALOG_VIEW_KEY);
    localStorage.removeItem(PRICE_CURRENCY_KEY);
    authStub.canManage.set(false);
    ratesStub.currencies.set([]);
  });

  function tabs(): HTMLButtonElement[] {
    return Array.from(
      fixture.nativeElement.querySelectorAll('[role="tab"]') as NodeListOf<HTMLButtonElement>,
    );
  }

  /** Etiquetas de las pestañas visibles, en el orden en que se pintan. */
  function tabLabels(): string[] {
    return tabs().map((button) => button.textContent?.trim() ?? '');
  }

  function tab(label: string): HTMLButtonElement {
    const found = tabs().find((button) => button.textContent?.trim() === label);
    if (!found) throw new Error(`No se encontró la pestaña "${label}"`);
    return found;
  }

  function panel(): HTMLElement {
    return fixture.nativeElement.querySelector('[role="tabpanel"]') as HTMLElement;
  }

  /** Botón de dentro del panel activo (ej. "Modo oscuro"). */
  function panelButton(text: string): HTMLButtonElement {
    const buttons = Array.from(
      panel().querySelectorAll('button') as NodeListOf<HTMLButtonElement>,
    );
    const found = buttons.find((button) => button.textContent?.includes(text));
    if (!found) throw new Error(`No se encontró el botón "${text}"`);
    return found;
  }

  function subtitle(): string {
    const header = fixture.nativeElement.querySelector('header') as HTMLElement;
    return header.textContent ?? '';
  }

  /** Radio de la columna Base de la tabla de monedas. */
  function baseRadio(code: string): HTMLInputElement {
    const radios = Array.from(
      fixture.nativeElement.querySelectorAll(
        'input[name="base-currency"]',
      ) as NodeListOf<HTMLInputElement>,
    );
    const found = radios.find((radio) => radio.value === code);
    if (!found) throw new Error(`No se encontró el selector de base para ${code}`);
    return found;
  }

  function pressArrow(button: HTMLButtonElement, key: string): void {
    button.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
    fixture.detectChanges();
  }

  it('divide la configuración en cinco pestañas y abre en Tasas', () => {
    expect(tabs().map((button) => button.textContent?.trim())).toEqual([
      'Tasas',
      'Apariencia',
      'Cajero',
      'Empresa',
      'Mis datos',
    ]);
    expect(tab('Tasas').getAttribute('aria-selected')).toBe('true');
    expect(tab('Apariencia').getAttribute('aria-selected')).toBe('false');
    expect(panel().id).toBe('rates-panel');
    expect(subtitle()).toContain('Tasas del BCV');
  });

  it('pinta solo la sección de la pestaña activa', () => {
    // Sin tasas cargadas, la sección de Tasas muestra su estado vacío.
    expect(panel().textContent).toContain('Sin tasas disponibles');
    expect(panel().textContent).not.toContain('Datos de la empresa');

    tab('Empresa').click();
    fixture.detectChanges();

    expect(panel().id).toBe('company-panel');
    expect(panel().textContent).toContain('Datos de la empresa');
    expect(panel().textContent).not.toContain('Sin tasas disponibles');

    tab('Mis datos').click();
    fixture.detectChanges();

    expect(panel().id).toBe('profile-panel');
    expect(panel().textContent).toContain('Guardar mis datos');
  });

  it('cambia el tema desde la pestaña Apariencia (y lo deja activo en <html>)', () => {
    tab('Apariencia').click();
    fixture.detectChanges();

    expect(panel().id).toBe('appearance-panel');
    expect(subtitle()).toContain('Modo claro u oscuro');

    panelButton('Modo oscuro').click();
    fixture.detectChanges();

    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(panelButton('Modo oscuro').getAttribute('aria-pressed')).toBe('true');
    expect(panelButton('Modo claro').getAttribute('aria-pressed')).toBe('false');

    panelButton('Modo claro').click();
    fixture.detectChanges();

    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });

  it('deja elegir la presentación de los formularios en la pestaña Apariencia', () => {
    tab('Apariencia').click();
    fixture.detectChanges();

    expect(panel().textContent).toContain('Formularios de caja y pedidos');

    panelButton('Panel lateral').click();
    fixture.detectChanges();

    expect(panelButton('Panel lateral').getAttribute('aria-pressed')).toBe('true');
  });

  it('guarda la propina sugerida de la empresa solo al pulsar «Guardar cambios»', () => {
    tab('Cajero').click();
    fixture.detectChanges();

    expect(panel().id).toBe('pos-panel');
    expect(panel().textContent).toContain('Propina sugerida');

    // El 10 % viene de fábrica y es la propina que el POS propone.
    expect(panelButton('10 %').getAttribute('aria-pressed')).toBe('true');

    panelButton('15 %').click();
    fixture.detectChanges();

    // Elegir no cambia nada todavía: la propina de la empresa sigue en 10 %.
    expect(panelButton('15 %').getAttribute('aria-pressed')).toBe('true');
    expect(panelButton('10 %').getAttribute('aria-pressed')).toBe('false');
    expect(localStorage.getItem(TIP_PERCENT_KEY)).toBeNull();

    panelButton('Guardar cambios').click();
    fixture.detectChanges();

    expect(localStorage.getItem(TIP_PERCENT_KEY)).toBe('15');

    // La propina es opcional: cero también es una opción válida.
    panelButton('Sin propina').click();
    fixture.detectChanges();

    expect(localStorage.getItem(TIP_PERCENT_KEY)).toBe('15');

    panelButton('Guardar cambios').click();
    fixture.detectChanges();

    expect(panelButton('Sin propina').getAttribute('aria-pressed')).toBe('true');
    expect(localStorage.getItem(TIP_PERCENT_KEY)).toBe('0');
  });

  const COP: CurrencyRateOption = {
    code: 'COP',
    label: 'Pesos colombianos',
    symbol: 'COL$',
    enabled: true,
    bsPerUnit: 0.22,
    source: 'MANUAL',
    isBase: false,
    isDisplayBase: false,
    bsPerUsd: 876.7976,
  };

  /** Selector de la moneda en la que el cajero ve los precios. */
  function priceCurrencySelect(): HTMLSelectElement {
    const found = panel().querySelector('#price-currency') as HTMLSelectElement | null;
    if (!found) throw new Error('No se encontró el selector de la moneda de los precios');
    return found;
  }

  /** Elige una moneda ('' = moneda base del sistema) como lo hace el usuario. */
  function pickPriceCurrency(code: string): void {
    const select = priceCurrencySelect();
    select.value = code;
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();
  }

  it('guarda la moneda de los precios del cajero al pulsar «Guardar cambios»', () => {
    const http = TestBed.inject(HttpTestingController);
    ratesStub.currencies.set([COP]);
    tab('Cajero').click();
    fixture.detectChanges();

    expect(panel().textContent).toContain('Moneda de los precios');

    // Por defecto los precios se ven en la moneda base configurada en Tasas.
    expect(priceCurrencySelect().value).toBe('');
    expect(panel().textContent).toContain('Moneda base (Dólares)');

    pickPriceCurrency('COP');

    // La vista previa adelanta cómo quedarían los precios, pero no se guarda nada.
    expect(localStorage.getItem(PRICE_CURRENCY_KEY)).toBeNull();
    expect(ratesStub.applyDisplayPreference).not.toHaveBeenCalled();
    expect(panel().textContent).toContain('Pesos colombianos (COP)');

    // La vista previa muestra cómo queda un precio con esa moneda.
    expect(panel().textContent).toContain('Un producto de $ 10.00 se ve COL$ 39,854.40');

    panelButton('Guardar cambios').click();
    fixture.detectChanges();

    expect(localStorage.getItem(PRICE_CURRENCY_KEY)).toBe('COP');
    // La pantalla avisa al servicio para que repinte los montos ya mismo.
    expect(ratesStub.applyDisplayPreference).toHaveBeenCalled();

    // Y la preferencia viaja a la empresa: la comparte todo el personal de caja.
    const guardado = http.expectOne({
      method: 'PATCH',
      url: `${environment.apiUrl}/preferences`,
    });
    expect(guardado.request.body).toEqual({
      tipPercent: 10,
      dialogView: 'modal',
      priceCurrency: 'COP',
    });
    guardado.flush({ tipPercent: 10, dialogView: 'modal', priceCurrency: 'COP' });

    // Volver a la moneda base borra la preferencia (también al guardar).
    pickPriceCurrency('');

    expect(localStorage.getItem(PRICE_CURRENCY_KEY)).toBe('COP');

    panelButton('Guardar cambios').click();
    fixture.detectChanges();

    expect(localStorage.getItem(PRICE_CURRENCY_KEY)).toBeNull();
    expect(panel().textContent).toContain('Moneda base (Dólares)');

    // En la empresa queda sin moneda configurada: se vuelve a la moneda base.
    const borrado = http.expectOne({
      method: 'PATCH',
      url: `${environment.apiUrl}/preferences`,
    });
    expect(borrado.request.body).toEqual({
      tipPercent: 10,
      dialogView: 'modal',
      priceCurrency: null,
    });
    borrado.flush({ tipPercent: 10, dialogView: 'modal', priceCurrency: null });
  });

  it('descarta lo elegido en la pestaña Cajero sin tocar lo guardado', async () => {
    ratesStub.currencies.set([COP]);
    tab('Cajero').click();
    fixture.detectChanges();

    // Sin cambios, el botón de guardar está apagado.
    expect(panelButton('Guardar cambios').disabled).toBe(true);

    panelButton('20 %').click();
    pickPriceCurrency('COP');

    expect(panelButton('Guardar cambios').disabled).toBe(false);
    expect(panel().textContent).toContain('Tienes cambios sin guardar');

    panelButton('Descartar').click();
    fixture.detectChanges();

    // El <select> recibe lo guardado en el turno siguiente: `NgModel` escribe en el
    // DOM desde un microtask.
    await esperar(() => priceCurrencySelect().value === '');

    expect(panelButton('10 %').getAttribute('aria-pressed')).toBe('true');
    expect(priceCurrencySelect().value).toBe('');
    expect(panelButton('Guardar cambios').disabled).toBe(true);
    expect(localStorage.getItem(TIP_PERCENT_KEY)).toBeNull();
    expect(localStorage.getItem(PRICE_CURRENCY_KEY)).toBeNull();
  });

  it('solo ofrece monedas habilitadas y con tasa para los precios del cajero', () => {
    ratesStub.currencies.set([
      COP,
      { ...COP, code: 'EUR', label: 'Euros', enabled: false },
      { ...COP, code: 'PEN', label: 'Soles', enabled: true, bsPerUnit: null },
    ]);
    tab('Cajero').click();
    fixture.detectChanges();

    const codes = Array.from(priceCurrencySelect().options).map((option) => option.value);

    expect(codes).toEqual(['', 'COP']);
  });

  it('avisa a los roles que administran que la preferencia no aplica a ellos', () => {
    authStub.canManage.set(true);
    tab('Cajero').click();
    fixture.detectChanges();

    expect(panel().textContent).toContain('Tu rol siempre ve el precio');
    expect(panel().textContent).toContain('esta preferencia la aplica el personal de caja');
  });

  it('recorre las pestañas con las flechas, Inicio y Fin', () => {
    pressArrow(tab('Tasas'), 'ArrowRight');
    expect(tab('Apariencia').getAttribute('aria-selected')).toBe('true');
    expect(panel().id).toBe('appearance-panel');
    expect(document.activeElement).toBe(tab('Apariencia'));

    pressArrow(tab('Apariencia'), 'ArrowLeft');
    expect(panel().id).toBe('rates-panel');

    pressArrow(tab('Tasas'), 'ArrowLeft');
    expect(panel().id).toBe('profile-panel');

    pressArrow(tab('Mis datos'), 'Home');
    expect(panel().id).toBe('rates-panel');

    pressArrow(tab('Tasas'), 'End');
    expect(panel().id).toBe('profile-panel');

    // Cualquier otra tecla no cambia de pestaña.
    pressArrow(tab('Mis datos'), 'Tab');
    expect(panel().id).toBe('profile-panel');
  });

  it('deja elegir la moneda base con la que se muestran los montos', () => {
    // La sección de monedas solo se pinta cuando las tasas ya cargaron.
    ratesStub.snapshot.set({});

    try {
      fixture.componentInstance.currencyRows = [
        {
          code: 'USD',
          label: 'Dólares',
          symbol: '$',
          enabled: true,
          rate: '',
          bsPerUnit: 876.7976,
          source: 'BCV',
          isBase: true,
          isDefault: true,
          canBeBase: true,
        },
        {
          code: 'VES',
          label: 'Bolívares',
          symbol: 'Bs',
          enabled: true,
          rate: '',
          bsPerUnit: 1,
          source: 'BASE',
          isBase: false,
          isDefault: true,
          canBeBase: true,
        },
        {
          code: 'COP',
          label: 'Pesos colombianos',
          symbol: 'COL$',
          enabled: false,
          rate: '',
          bsPerUnit: null,
          source: 'NONE',
          isBase: false,
          isDefault: false,
          canBeBase: false,
        },
      ];
      fixture.detectChanges();

      // La moneda base guardada es el dólar; el bolívar puede reemplazarlo.
      expect(baseRadio('USD').checked).toBe(true);
      // Una moneda sin tasa no puede ser la base.
      expect(baseRadio('COP').disabled).toBe(true);

      const ves = baseRadio('VES');
      ves.checked = true;
      ves.dispatchEvent(new Event('change', { bubbles: true }));
      fixture.detectChanges();

      expect(baseRadio('VES').checked).toBe(true);
      expect(panel().textContent).toContain('Bolívares (VES)');

      fixture.componentInstance.saveCurrencies();

      expect(currenciesStub.save).toHaveBeenCalledWith(
        jasmine.any(Array),
        'VES',
        jasmine.any(Function),
      );
    } finally {
      ratesStub.snapshot.set(null);
    }
  });

  it('enseña la pestaña Datos solo a quien puede administrar el catálogo', () => {
    // Importar escribe el catálogo del local: el API solo lo permite a ADMIN y
    // MANAGER, así que al resto de los roles no se les ofrece la pestaña.
    expect(tabLabels()).not.toContain('Datos');

    authStub.canManage.set(true);
    fixture.detectChanges();

    expect(tabLabels()).toContain('Datos');

    tab('Datos').click();
    fixture.detectChanges();

    expect(panel().id).toBe('data-panel');
    expect(panel().textContent).toContain('Exportar el catálogo');
    expect(panel().textContent).toContain('Importar el catálogo');
    // Todavía nadie ha importado: no hay resumen que mostrar.
    expect(panel().textContent).not.toContain('Resultado de la importación');
  });

  it('exporta el catálogo e importa el archivo elegido desde la pestaña Datos', async () => {
    // El clic del enlace de descarga se anula: aquí se comprueba el flujo, no el archivo.
    spyOn(HTMLAnchorElement.prototype, 'click').and.callFake(() => undefined);

    authStub.canManage.set(true);
    fixture.detectChanges();

    tab('Datos').click();
    fixture.detectChanges();

    panelButton('Descargar respaldo').click();
    fixture.detectChanges();

    expect(dataTransferStub.exportCatalog).toHaveBeenCalledTimes(1);

    // Modo «dejar los que ya existen»: viaja al API en el query string.
    panelButton('Dejar los que ya existen').click();
    fixture.detectChanges();

    const input = fixture.nativeElement.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement;
    const transfer = new DataTransfer();
    transfer.items.add(
      new File([JSON.stringify(catalogoExportado)], 'catalogo.json', {
        type: 'application/json',
      }),
    );
    input.files = transfer.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));

    // El archivo se lee en el navegador y, antes de tocar nada, se pide confirmación.
    const confirm = TestBed.inject(ConfirmService);
    await esperar(() => confirm.state().open);
    fixture.detectChanges();

    expect(confirm.state().open).toBe(true);
    expect(confirm.state().message).toContain('catalogo.json');
    expect(dataTransferStub.importCatalog).not.toHaveBeenCalled();

    confirm.resolve(true);
    await esperar(() => dataTransferStub.importCatalog.calls.count() > 0);
    fixture.detectChanges();

    expect(dataTransferStub.importCatalog).toHaveBeenCalledWith(
      jasmine.objectContaining({ format: 'nexo-hub.catalog' }),
      'skip',
    );

    // El resumen queda a la vista: guardados por entidad y los avisos del API.
    expect(panel().textContent).toContain('Resultado de la importación');
    expect(panel().textContent).toContain('2 guardados');
    expect(panel().textContent).toContain('No se encontró el ingrediente CAF-2.');
  });
});
