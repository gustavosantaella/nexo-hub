import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { environment } from '../../../environments/environment';
import type { CompanyPreferences } from '../models/api.model';
import {
  DEFAULT_TIP_PERCENT,
  PreferencesService,
  normalizeChargeRateKey,
  normalizeConversionCurrencies,
  normalizePriceCurrency,
  normalizeShowBcvPrice,
  normalizePosView,
  normalizeTipPercent,
} from './preferences.service';

/** Endpoint de las preferencias de la empresa activa. */
const API = `${environment.apiUrl}/preferences`;

/** Clave de `localStorage` de la preferencia (igual que en el servicio). */
const DIALOG_VIEW_KEY = 'nexo-hub.dialog-view';

/** Clave de `localStorage` de la propina sugerida. */
const TIP_PERCENT_KEY = 'nexo-hub.tip-percent';

/** Clave de `localStorage` de la moneda en la que el cajero ve los precios. */
const PRICE_CURRENCY_KEY = 'nexo-hub.price-currency';

/** Clave de `localStorage` de las conversiones que ve el cajero. */
const CONVERSION_CURRENCIES_KEY = 'nexo-hub.conversion-currencies';

/** Clave de `localStorage` del precio en dólares del BCV. */
const SHOW_BCV_PRICE_KEY = 'nexo-hub.show-bcv-price';

/** Clave de `localStorage` de la tasa con la que cobra el cajero. */
const CHARGE_RATE_KEY = 'nexo-hub.charge-rate';

/** Clave de `localStorage` de la vista del catálogo del cajero. */
const POS_VIEW_KEY = 'nexo-hub.pos-view';

/** Monta el doble de `HttpClient` y devuelve el controlador de peticiones. */
function configureHttp(): HttpTestingController {
  TestBed.configureTestingModule({
    providers: [provideHttpClient(), provideHttpClientTesting()],
  });
  return TestBed.inject(HttpTestingController);
}

/**
 * Respuesta de `GET/PATCH /preferences` tal como la manda el API: el servidor
 * devuelve siempre los cinco campos (`null` = sin configurar).
 */
function prefs(overrides: Partial<CompanyPreferences> = {}): CompanyPreferences {
  return {
    tipPercent: DEFAULT_TIP_PERCENT,
    dialogView: 'modal',
    priceCurrency: null,
    conversionCurrencies: null,
    showBcvPrice: null,
    chargeRateKey: null,
    ...overrides,
  };
}

describe('PreferencesService (propina y formularios de la empresa)', () => {
  let http: HttpTestingController;

  beforeEach(() => {
    localStorage.clear();
    http = configureHttp();
  });

  afterEach(() => {
    localStorage.clear();
    // Ninguna prueba puede dejar peticiones sin responder.
    http.verify();
  });

  function service(): PreferencesService {
    return TestBed.inject(PreferencesService);
  }

  /**
   * Vuelve a montar el módulo para que el servicio relea lo guardado en el
   * navegador, como hace el arranque de la aplicación.
   */
  function remounted(): PreferencesService {
    TestBed.resetTestingModule();
    http = configureHttp();
    return TestBed.inject(PreferencesService);
  }

  /** Responde al guardado (`PATCH /preferences`) como lo haría el API. */
  function flushSave(preferences: CompanyPreferences): void {
    http.expectOne({ method: 'PATCH', url: API }).flush(preferences);
  }

  it('usa la ventana modal y el 10 % de propina por defecto', () => {
    expect(service().dialogView()).toBe('modal');
    expect(service().formsInSidebar()).toBeFalse();
    expect(service().tipPercent()).toBe(DEFAULT_TIP_PERCENT);
  });

  it('guarda la presentación elegida en la empresa y en el navegador', () => {
    const preferences = service();
    preferences.setDialogView('sidebar');

    expect(preferences.dialogView()).toBe('sidebar');
    expect(preferences.formsInSidebar()).toBeTrue();
    // Copia local: el arranque pinta con ella antes de que conteste el servidor.
    expect(localStorage.getItem(DIALOG_VIEW_KEY)).toBe('sidebar');

    const request = http.expectOne({ method: 'PATCH', url: API });
    expect(request.request.body).toEqual({
      tipPercent: DEFAULT_TIP_PERCENT,
      dialogView: 'sidebar',
      priceCurrency: null,
      conversionCurrencies: null,
      showBcvPrice: false,
      chargeRateKey: null,
    });
    request.flush(prefs({ dialogView: 'sidebar' }));
  });

  it('recupera la vista guardada y descarta valores desconocidos', () => {
    localStorage.setItem(DIALOG_VIEW_KEY, 'sidebar');
    expect(service().dialogView()).toBe('sidebar');

    localStorage.setItem(DIALOG_VIEW_KEY, 'flotante');
    expect(remounted().dialogView()).toBe('modal');
  });

  it('mantiene una sola preferencia para caja y pedidos', () => {
    const preferences = service();
    preferences.setDialogView('sidebar');
    flushSave(prefs({ dialogView: 'sidebar' }));

    // Caja y pedidos leen el mismo signal: cambiar la preferencia los afecta a
    // ambos por igual.
    expect(preferences.dialogView()).toBe('sidebar');
    expect(preferences.formsInSidebar()).toBeTrue();
  });

  it('sugiere una propina del 10 % que se puede ajustar y persiste', () => {
    const preferences = service();
    expect(preferences.tipPercent()).toBe(DEFAULT_TIP_PERCENT);

    preferences.setTipPercent(15);
    expect(preferences.tipPercent()).toBe(15);
    expect(localStorage.getItem(TIP_PERCENT_KEY)).toBe('15');
    flushSave(prefs({ tipPercent: 15 }));

    // La propina es opcional: cero es un valor válido.
    preferences.setTipPercent(0);
    expect(preferences.tipPercent()).toBe(0);
    flushSave(prefs({ tipPercent: 0 }));
  });

  it('limita la propina sugerida a un porcentaje razonable', () => {
    const preferences = service();

    preferences.setTipPercent(180);
    expect(preferences.tipPercent()).toBe(100);
    flushSave(prefs({ tipPercent: 100 }));

    preferences.setTipPercent(-5);
    expect(preferences.tipPercent()).toBe(0);
    flushSave(prefs({ tipPercent: 0 }));

    preferences.setTipPercent(Number.NaN);
    expect(preferences.tipPercent()).toBe(0);
    flushSave(prefs({ tipPercent: 0 }));
  });

  it('recupera la propina guardada y descarta valores inválidos', () => {
    localStorage.setItem(TIP_PERCENT_KEY, '12.5');
    expect(service().tipPercent()).toBe(12.5);

    localStorage.setItem(TIP_PERCENT_KEY, 'mucho');
    expect(remounted().tipPercent()).toBe(0);

    localStorage.setItem(TIP_PERCENT_KEY, '');
    expect(remounted().tipPercent()).toBe(DEFAULT_TIP_PERCENT);
  });

  it('toma la propina y los formularios que tiene la empresa al entrar', () => {
    const preferences = service();
    preferences.load();

    http
      .expectOne({ method: 'GET', url: API })
      .flush(prefs({ tipPercent: 15, dialogView: 'sidebar' }));

    expect(preferences.tipPercent()).toBe(15);
    expect(preferences.dialogView()).toBe('sidebar');
    // La copia local queda al día para el próximo arranque.
    expect(localStorage.getItem(TIP_PERCENT_KEY)).toBe('15');
    expect(localStorage.getItem(DIALOG_VIEW_KEY)).toBe('sidebar');
  });

  it('el cajero que entra desde otro navegador recibe lo de la empresa', () => {
    // Equipo recién estrenado: este navegador no tiene nada guardado.
    const preferences = service();
    preferences.load();
    http
      .expectOne({ method: 'GET', url: API })
      .flush(prefs({ tipPercent: 0, dialogView: 'sidebar' }));

    expect(preferences.tipPercent()).toBe(0);
    expect(preferences.dialogView()).toBe('sidebar');
    // Y queda en el navegador, que es lo que pide el punto de venta al personal.
    expect(localStorage.getItem(TIP_PERCENT_KEY)).toBe('0');
    expect(localStorage.getItem(DIALOG_VIEW_KEY)).toBe('sidebar');
  });

  it('la empresa manda: sin configurar se vuelve a los valores de fábrica', () => {
    // Este equipo traía otra cosa guardada (de quien lo usó antes o de una
    // versión anterior), pero la empresa no tiene nada configurado.
    localStorage.setItem(TIP_PERCENT_KEY, '20');
    localStorage.setItem(DIALOG_VIEW_KEY, 'sidebar');

    const preferences = service();
    preferences.load();
    http
      .expectOne({ method: 'GET', url: API })
      .flush(prefs({ tipPercent: null, dialogView: null }));

    expect(preferences.tipPercent()).toBe(DEFAULT_TIP_PERCENT);
    expect(preferences.dialogView()).toBe('modal');
    // La copia local queda igualada a lo que dice el servidor.
    expect(localStorage.getItem(TIP_PERCENT_KEY)).toBe(String(DEFAULT_TIP_PERCENT));
    expect(localStorage.getItem(DIALOG_VIEW_KEY)).toBe('modal');
    // Sin configurar no se sube nada: el `http.verify()` del `afterEach` lo ve.
  });

  it('sin conexión sigue con las preferencias de este navegador', () => {
    localStorage.setItem(TIP_PERCENT_KEY, '5');

    const preferences = service();
    preferences.load();
    http
      .expectOne({ method: 'GET', url: API })
      .flush('', { status: 500, statusText: 'Server Error' });

    expect(preferences.tipPercent()).toBe(5);
    expect(preferences.dialogView()).toBe('modal');
  });

  it('no pisa lo que el usuario elige mientras llega la respuesta del servidor', () => {
    const preferences = service();
    preferences.load();

    // El usuario alcanza a tocar la propina antes de que conteste el servidor.
    preferences.setTipPercent(20);
    flushSave(prefs({ tipPercent: 20 }));

    http
      .expectOne({ method: 'GET', url: API })
      .flush(prefs({ tipPercent: 15, dialogView: 'sidebar' }));

    expect(preferences.tipPercent()).toBe(20);
    expect(preferences.dialogView()).toBe('modal');
  });

  it('olvida las preferencias al cerrar sesión (equipo compartido)', () => {
    const preferences = service();
    preferences.setTipPercent(25);
    flushSave(prefs({ tipPercent: 25 }));
    preferences.setDialogView('sidebar');
    flushSave(prefs({ tipPercent: 25, dialogView: 'sidebar' }));
    preferences.setPriceCurrency('ves');
    flushSave(prefs({ tipPercent: 25, dialogView: 'sidebar', priceCurrency: 'VES' }));

    preferences.clear();

    expect(preferences.tipPercent()).toBe(DEFAULT_TIP_PERCENT);
    expect(preferences.dialogView()).toBe('modal');
    expect(preferences.priceCurrency()).toBeNull();
    expect(preferences.conversionCurrencies()).toBeNull();
    expect(localStorage.getItem(TIP_PERCENT_KEY)).toBeNull();
    expect(localStorage.getItem(DIALOG_VIEW_KEY)).toBeNull();
    expect(localStorage.getItem(PRICE_CURRENCY_KEY)).toBeNull();
    expect(localStorage.getItem(CONVERSION_CURRENCIES_KEY)).toBeNull();
  });
});

describe('PreferencesService (moneda de los precios de la empresa)', () => {
  let http: HttpTestingController;

  beforeEach(() => {
    localStorage.clear();
    http = configureHttp();
  });

  afterEach(() => {
    localStorage.clear();
    http.verify();
  });

  /**
   * Vuelve a montar el módulo para que el servicio relea lo guardado en el
   * navegador, como hace el arranque de la aplicación.
   */
  function remounted(): PreferencesService {
    TestBed.resetTestingModule();
    http = configureHttp();
    return TestBed.inject(PreferencesService);
  }

  /** Responde al guardado (`PATCH /preferences`) como lo haría el API. */
  function flushSave(preferences: CompanyPreferences): void {
    http.expectOne({ method: 'PATCH', url: API }).flush(preferences);
  }

  it('ve los precios en la moneda base mientras la empresa no elija otra', () => {
    expect(TestBed.inject(PreferencesService).priceCurrency()).toBeNull();
  });

  it('guarda la moneda de los precios en la empresa y en la copia del navegador', () => {
    const preferences = TestBed.inject(PreferencesService);

    // El código se normaliza: `cop` es la misma moneda que `COP`.
    preferences.setPriceCurrency('cop');
    expect(preferences.priceCurrency()).toBe('COP');
    expect(localStorage.getItem(PRICE_CURRENCY_KEY)).toBe('COP');

    // Viaja a la empresa junto con el resto de preferencias.
    const request = http.expectOne({ method: 'PATCH', url: API });
    expect(request.request.body).toEqual({
      tipPercent: DEFAULT_TIP_PERCENT,
      dialogView: 'modal',
      priceCurrency: 'COP',
      conversionCurrencies: null,
      showBcvPrice: false,
      chargeRateKey: null,
    });
    request.flush(prefs({ priceCurrency: 'COP' }));

    // Volver a la moneda base borra la preferencia (también en la copia local).
    preferences.setPriceCurrency(null);
    expect(preferences.priceCurrency()).toBeNull();
    expect(localStorage.getItem(PRICE_CURRENCY_KEY)).toBeNull();
    flushSave(prefs());
  });

  it('recupera la moneda guardada y descarta códigos inválidos', () => {
    localStorage.setItem(PRICE_CURRENCY_KEY, 'eur');
    expect(TestBed.inject(PreferencesService).priceCurrency()).toBe('EUR');

    localStorage.setItem(PRICE_CURRENCY_KEY, 'bolívares');
    expect(remounted().priceCurrency()).toBeNull();
  });

  it('el cajero que entra desde otro navegador recibe la moneda de la empresa', () => {
    // Equipo recién estrenado: este navegador no tiene nada guardado.
    const preferences = TestBed.inject(PreferencesService);
    expect(preferences.priceCurrency()).toBeNull();

    preferences.load();
    http
      .expectOne({ method: 'GET', url: API })
      .flush(prefs({ priceCurrency: 'ves' }));

    expect(preferences.priceCurrency()).toBe('VES');
    // Y queda en el navegador para el próximo arranque.
    expect(localStorage.getItem(PRICE_CURRENCY_KEY)).toBe('VES');
  });

  it('la empresa manda: sin moneda configurada se vuelve a la moneda base', () => {
    // Este equipo traía otra cosa guardada (de quien lo usó antes).
    localStorage.setItem(PRICE_CURRENCY_KEY, 'COP');

    const preferences = TestBed.inject(PreferencesService);
    expect(preferences.priceCurrency()).toBe('COP');

    preferences.load();
    http
      .expectOne({ method: 'GET', url: API })
      .flush(prefs({ priceCurrency: null }));

    expect(preferences.priceCurrency()).toBeNull();
    expect(localStorage.getItem(PRICE_CURRENCY_KEY)).toBeNull();
  });
});

describe('PreferencesService (conversiones que ve el cajero)', () => {
  let http: HttpTestingController;

  beforeEach(() => {
    localStorage.clear();
    http = configureHttp();
  });

  afterEach(() => {
    localStorage.clear();
    http.verify();
  });

  function remounted(): PreferencesService {
    TestBed.resetTestingModule();
    http = configureHttp();
    return TestBed.inject(PreferencesService);
  }

  it('sin configurar el cajero no ve ninguna conversión', () => {
    expect(TestBed.inject(PreferencesService).conversionCurrencies()).toBeNull();
  });

  it('guarda las conversiones del cajero en la empresa y en el navegador', () => {
    const preferences = TestBed.inject(PreferencesService);

    // Los códigos se normalizan (`cop` es `COP`) y los repetidos no se guardan.
    preferences.setConversionCurrencies(['usd', 'cop', 'USD']);
    expect(preferences.conversionCurrencies()).toEqual(['USD', 'COP']);
    expect(localStorage.getItem(CONVERSION_CURRENCIES_KEY)).toBe('["USD","COP"]');

    const request = http.expectOne({ method: 'PATCH', url: API });
    expect(request.request.body).toEqual({
      tipPercent: DEFAULT_TIP_PERCENT,
      dialogView: 'modal',
      priceCurrency: null,
      conversionCurrencies: ['USD', 'COP'],
      showBcvPrice: false,
      chargeRateKey: null,
    });
    request.flush(prefs({ conversionCurrencies: ['USD', 'COP'] }));

    // Quitar todas devuelve al cajero a su moneda (se borra la preferencia).
    preferences.setConversionCurrencies([]);
    expect(preferences.conversionCurrencies()).toBeNull();
    expect(localStorage.getItem(CONVERSION_CURRENCIES_KEY)).toBeNull();
    http.expectOne({ method: 'PATCH', url: API }).flush(prefs());
  });

  it('una lista sin códigos válidos se descarta (vuelve a `null`)', () => {
    const preferences = TestBed.inject(PreferencesService);

    preferences.setConversionCurrencies(['bolívares', 'X']);
    expect(preferences.conversionCurrencies()).toBeNull();
    http.expectOne({ method: 'PATCH', url: API }).flush(prefs());
  });

  it('recupera lo guardado en el navegador y descarta lo corrupto', () => {
    localStorage.setItem(CONVERSION_CURRENCIES_KEY, '["eur"]');
    expect(TestBed.inject(PreferencesService).conversionCurrencies()).toEqual(['EUR']);

    localStorage.setItem(CONVERSION_CURRENCIES_KEY, 'no es json');
    expect(remounted().conversionCurrencies()).toBeNull();
  });

  it('el cajero que entra desde otro navegador recibe las conversiones de la empresa', () => {
    const preferences = TestBed.inject(PreferencesService);
    expect(preferences.conversionCurrencies()).toBeNull();

    preferences.load();
    http
      .expectOne({ method: 'GET', url: API })
      .flush(prefs({ priceCurrency: 'VES', conversionCurrencies: ['USD'] }));

    expect(preferences.conversionCurrencies()).toEqual(['USD']);
    expect(localStorage.getItem(CONVERSION_CURRENCIES_KEY)).toBe('["USD"]');
  });

  it('la empresa manda: sin conversiones configuradas se borran las de este equipo', () => {
    localStorage.setItem(CONVERSION_CURRENCIES_KEY, '["COP"]');

    const preferences = TestBed.inject(PreferencesService);
    expect(preferences.conversionCurrencies()).toEqual(['COP']);

    preferences.load();
    http
      .expectOne({ method: 'GET', url: API })
      .flush(prefs({ conversionCurrencies: null }));

    expect(preferences.conversionCurrencies()).toBeNull();
    expect(localStorage.getItem(CONVERSION_CURRENCIES_KEY)).toBeNull();
  });
});

describe('PreferencesService (actualizar preferencias del cajero)', () => {
  let http: HttpTestingController;

  beforeEach(() => {
    localStorage.clear();
    http = configureHttp();
  });

  afterEach(() => {
    localStorage.clear();
    http.verify();
  });

  it('trae de nuevo lo que el admin acaba de guardar, sin cerrar sesión', () => {
    const preferences = TestBed.inject(PreferencesService);
    // Al entrar, la empresa no tenía nada configurado para el cajero.
    preferences.load();
    http.expectOne({ method: 'GET', url: API }).flush(prefs());
    expect(preferences.conversionCurrencies()).toBeNull();

    // El admin guarda desde su equipo mientras la caja sigue abierta.
    preferences.refresh().subscribe();
    http
      .expectOne({ method: 'GET', url: API })
      .flush(
        prefs({
          tipPercent: 15,
          priceCurrency: 'VES',
          conversionCurrencies: ['USD'],
          showBcvPrice: true,
        }),
      );

    expect(preferences.tipPercent()).toBe(15);
    expect(preferences.priceCurrency()).toBe('VES');
    expect(preferences.conversionCurrencies()).toEqual(['USD']);
    expect(preferences.showBcvPrice()).toBeTrue();
    // Y queda como copia en este navegador, que es lo que pinta el punto de venta.
    expect(localStorage.getItem(TIP_PERCENT_KEY)).toBe('15');
    expect(localStorage.getItem(PRICE_CURRENCY_KEY)).toBe('VES');
    expect(localStorage.getItem(CONVERSION_CURRENCIES_KEY)).toBe('["USD"]');
    expect(localStorage.getItem(SHOW_BCV_PRICE_KEY)).toBe('true');
  });

  it('lo del servidor manda aunque se toque algo mientras llega la respuesta', () => {
    const preferences = TestBed.inject(PreferencesService);
    preferences.refresh().subscribe();

    // El cajero alcanza a elegir otra propina antes de que conteste el servidor:
    // la pulsación del botón es explícita, así que se queda con lo guardado.
    preferences.setTipPercent(20);
    http.expectOne({ method: 'PATCH', url: API }).flush(prefs({ tipPercent: 20 }));

    http.expectOne({ method: 'GET', url: API }).flush(prefs({ tipPercent: 5 }));

    expect(preferences.tipPercent()).toBe(5);
  });

  it('sin conexión deja al cajero con lo que ya tenía', () => {
    localStorage.setItem(TIP_PERCENT_KEY, '5');

    const preferences = TestBed.inject(PreferencesService);
    expect(preferences.tipPercent()).toBe(5);

    preferences.refresh().subscribe({ error: () => undefined });
    http
      .expectOne({ method: 'GET', url: API })
      .flush('', { status: 500, statusText: 'Server Error' });

    expect(preferences.tipPercent()).toBe(5);
  });
});

describe('PreferencesService (precio en dólares del BCV para el cajero)', () => {
  let http: HttpTestingController;

  beforeEach(() => {
    localStorage.clear();
    http = configureHttp();
  });

  afterEach(() => {
    localStorage.clear();
    http.verify();
  });

  it('sin configurar el cajero no ve el precio en dólares del BCV', () => {
    expect(TestBed.inject(PreferencesService).showBcvPrice()).toBeFalse();
  });

  it('guarda el precio en dólares del BCV en la empresa y en el navegador', () => {
    const preferences = TestBed.inject(PreferencesService);

    preferences.setShowBcvPrice(true);
    expect(preferences.showBcvPrice()).toBeTrue();
    expect(localStorage.getItem(SHOW_BCV_PRICE_KEY)).toBe('true');

    // Viaja a la empresa junto con el resto de preferencias del cajero.
    const request = http.expectOne({ method: 'PATCH', url: API });
    expect(request.request.body).toEqual({
      tipPercent: DEFAULT_TIP_PERCENT,
      dialogView: 'modal',
      priceCurrency: null,
      conversionCurrencies: null,
      showBcvPrice: true,
      chargeRateKey: null,
    });
    request.flush(prefs({ showBcvPrice: true }));

    // Apagarlo vuelve a lo de fábrica y se lleva la copia local.
    preferences.setShowBcvPrice(false);
    expect(preferences.showBcvPrice()).toBeFalse();
    expect(localStorage.getItem(SHOW_BCV_PRICE_KEY)).toBeNull();
    http.expectOne({ method: 'PATCH', url: API }).flush(prefs());
  });

  it('el cajero que entra desde otro navegador recibe el de la empresa', () => {
    const preferences = TestBed.inject(PreferencesService);
    expect(preferences.showBcvPrice()).toBeFalse();

    preferences.load();
    http
      .expectOne({ method: 'GET', url: API })
      .flush(prefs({ showBcvPrice: true }));

    expect(preferences.showBcvPrice()).toBeTrue();
    expect(localStorage.getItem(SHOW_BCV_PRICE_KEY)).toBe('true');
  });

  it('la empresa manda: sin configurar se borra el de este equipo', () => {
    localStorage.setItem(SHOW_BCV_PRICE_KEY, 'true');

    const preferences = TestBed.inject(PreferencesService);
    expect(preferences.showBcvPrice()).toBeTrue();

    preferences.load();
    http.expectOne({ method: 'GET', url: API }).flush(prefs({ showBcvPrice: null }));

    expect(preferences.showBcvPrice()).toBeFalse();
    expect(localStorage.getItem(SHOW_BCV_PRICE_KEY)).toBeNull();
  });
});

describe('PreferencesService (tasa de cobro del cajero)', () => {
  let http: HttpTestingController;

  beforeEach(() => {
    localStorage.clear();
    http = configureHttp();
  });

  afterEach(() => {
    localStorage.clear();
    http.verify();
  });

  it('sin configurar el cajero cobra con la tasa activa del sistema', () => {
    expect(TestBed.inject(PreferencesService).chargeRateKey()).toBeNull();
  });

  it('guarda la tasa de cobro en la empresa y en el navegador', () => {
    const preferences = TestBed.inject(PreferencesService);

    // La clave se normaliza (`bcv_usd` es `BCV_USD`).
    preferences.setChargeRateKey('bcv_usd');
    expect(preferences.chargeRateKey()).toBe('BCV_USD');
    expect(localStorage.getItem(CHARGE_RATE_KEY)).toBe('BCV_USD');

    const request = http.expectOne({ method: 'PATCH', url: API });
    expect(request.request.body).toEqual({
      tipPercent: DEFAULT_TIP_PERCENT,
      dialogView: 'modal',
      priceCurrency: null,
      conversionCurrencies: null,
      showBcvPrice: false,
      chargeRateKey: 'BCV_USD',
    });
    request.flush(prefs({ chargeRateKey: 'BCV_USD' }));

    // Volver a la tasa activa borra la preferencia (también en la copia local).
    preferences.setChargeRateKey(null);
    expect(preferences.chargeRateKey()).toBeNull();
    expect(localStorage.getItem(CHARGE_RATE_KEY)).toBeNull();
    http.expectOne({ method: 'PATCH', url: API }).flush(prefs());
  });

  it('una tasa que no sirve para cobrar se descarta (vuelve a la activa)', () => {
    const preferences = TestBed.inject(PreferencesService);

    preferences.setChargeRateKey('BCV_EUR');
    expect(preferences.chargeRateKey()).toBeNull();
    http.expectOne({ method: 'PATCH', url: API }).flush(prefs());
  });

  it('recupera lo guardado en el navegador y descarta lo inválido', () => {
    localStorage.setItem(CHARGE_RATE_KEY, 'custom_usd');
    expect(TestBed.inject(PreferencesService).chargeRateKey()).toBe('CUSTOM_USD');

    localStorage.setItem(CHARGE_RATE_KEY, 'euros');
    TestBed.resetTestingModule();
    http = configureHttp();
    expect(TestBed.inject(PreferencesService).chargeRateKey()).toBeNull();
  });

  it('el cajero que entra desde otro navegador recibe la tasa de la empresa', () => {
    const preferences = TestBed.inject(PreferencesService);
    expect(preferences.chargeRateKey()).toBeNull();

    preferences.load();
    http.expectOne({ method: 'GET', url: API }).flush(prefs({ chargeRateKey: 'BCV_USD' }));

    expect(preferences.chargeRateKey()).toBe('BCV_USD');
    expect(localStorage.getItem(CHARGE_RATE_KEY)).toBe('BCV_USD');
  });

  it('la empresa manda: sin configurar se borra la de este equipo', () => {
    localStorage.setItem(CHARGE_RATE_KEY, 'CUSTOM_USD');

    const preferences = TestBed.inject(PreferencesService);
    expect(preferences.chargeRateKey()).toBe('CUSTOM_USD');

    preferences.load();
    http.expectOne({ method: 'GET', url: API }).flush(prefs({ chargeRateKey: null }));

    expect(preferences.chargeRateKey()).toBeNull();
    expect(localStorage.getItem(CHARGE_RATE_KEY)).toBeNull();
  });
});

describe('PreferencesService (vista del catálogo del cajero)', () => {
  let http: HttpTestingController;

  beforeEach(() => {
    localStorage.clear();
    http = configureHttp();
  });

  afterEach(() => {
    localStorage.clear();
    http.verify();
  });

  it('guarda la vista del catálogo del cajero para la empresa', () => {
    const preferences = TestBed.inject(PreferencesService);

    preferences.setPosView('table');

    expect(preferences.posView()).toBe('table');
    expect(localStorage.getItem(POS_VIEW_KEY)).toBe('table');

    const request = http.expectOne({ method: 'PATCH', url: API });
    expect(request.request.body).toEqual({
      tipPercent: DEFAULT_TIP_PERCENT,
      dialogView: 'modal',
      priceCurrency: null,
      conversionCurrencies: null,
      showBcvPrice: false,
      chargeRateKey: null,
      posView: 'table',
    });
    request.flush(prefs({ posView: 'table' }));
  });

  it('recupera la vista del catálogo guardada y descarta valores desconocidos', () => {
    localStorage.setItem(POS_VIEW_KEY, 'columns');
    expect(TestBed.inject(PreferencesService).posView()).toBe('columns');

    localStorage.setItem(POS_VIEW_KEY, 'lista');
    TestBed.resetTestingModule();
    http = configureHttp();
    expect(TestBed.inject(PreferencesService).posView()).toBe('cards');
  });
});

describe('normalizeChargeRateKey', () => {
  it('solo acepta las tasas del dólar que pueden cobrar', () => {
    expect(normalizeChargeRateKey('bcv_usd')).toBe('BCV_USD');
    expect(normalizeChargeRateKey(' custom_usd ')).toBe('CUSTOM_USD');

    expect(normalizeChargeRateKey('BCV_EUR')).toBeNull();
    expect(normalizeChargeRateKey('')).toBeNull();
    expect(normalizeChargeRateKey(null)).toBeNull();
    expect(normalizeChargeRateKey(undefined)).toBeNull();
  });
});

describe('normalizeShowBcvPrice', () => {
  it('solo enciende con un `true` (o con lo que guarda el navegador)', () => {
    expect(normalizeShowBcvPrice(true)).toBeTrue();
    expect(normalizeShowBcvPrice('true')).toBeTrue();
    expect(normalizeShowBcvPrice(1)).toBeTrue();
    expect(normalizeShowBcvPrice('1')).toBeTrue();

    expect(normalizeShowBcvPrice(false)).toBeFalse();
    expect(normalizeShowBcvPrice(null)).toBeFalse();
    expect(normalizeShowBcvPrice(undefined)).toBeFalse();
    expect(normalizeShowBcvPrice('sí')).toBeFalse();
  });
});

describe('normalizePosView', () => {
  it('acepta solo las vistas del catálogo y normaliza mayúsculas', () => {
    expect(normalizePosView('cards')).toBe('cards');
    expect(normalizePosView(' TABLE ')).toBe('table');
    expect(normalizePosView('Columns')).toBe('columns');
    expect(normalizePosView('lista')).toBeNull();
    expect(normalizePosView(null)).toBeNull();
    expect(normalizePosView(undefined)).toBeNull();
  });
});

describe('normalizeConversionCurrencies', () => {
  it('deja códigos en mayúsculas, sin repetir y descarta lo que no es una moneda', () => {
    expect(normalizeConversionCurrencies(['cop', 'USD', 'cop'])).toEqual(['COP', 'USD']);
    expect(normalizeConversionCurrencies([' ves '])).toEqual(['VES']);
    expect(normalizeConversionCurrencies('["usd","cop"]')).toEqual(['USD', 'COP']);
    expect(normalizeConversionCurrencies([])).toBeNull();
    expect(normalizeConversionCurrencies(['Bs', 'bolívares'])).toBeNull();
    expect(normalizeConversionCurrencies('{no es json}')).toBeNull();
    expect(normalizeConversionCurrencies(null)).toBeNull();
    expect(normalizeConversionCurrencies(undefined)).toBeNull();
  });
});

describe('normalizePriceCurrency', () => {
  it('deja el código en mayúsculas y descarta lo que no es una moneda', () => {
    expect(normalizePriceCurrency('cop')).toBe('COP');
    expect(normalizePriceCurrency(' ves ')).toBe('VES');
    expect(normalizePriceCurrency('')).toBeNull();
    expect(normalizePriceCurrency('Bs')).toBeNull();
    expect(normalizePriceCurrency('bolívares')).toBeNull();
    expect(normalizePriceCurrency(null)).toBeNull();
    expect(normalizePriceCurrency(undefined)).toBeNull();
  });
});

describe('normalizeTipPercent', () => {
  it('acepta el rango 0-100 y redondea a dos decimales', () => {
    expect(normalizeTipPercent(10)).toBe(10);
    expect(normalizeTipPercent('10.129')).toBe(10.13);
    expect(normalizeTipPercent(150)).toBe(100);
    expect(normalizeTipPercent(-1)).toBe(0);
    expect(normalizeTipPercent(null)).toBe(0);
    expect(normalizeTipPercent(undefined)).toBe(0);
    expect(normalizeTipPercent('abc')).toBe(0);
  });
});
