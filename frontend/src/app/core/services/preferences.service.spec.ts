import { TestBed } from '@angular/core/testing';
import {
  DEFAULT_TIP_PERCENT,
  PreferencesService,
  normalizeTipPercent,
} from './preferences.service';

/** Clave de `localStorage` de la preferencia (igual que en el servicio). */
const DIALOG_VIEW_KEY = 'nexo-hub.dialog-view';

/** Clave de `localStorage` de la propina sugerida. */
const TIP_PERCENT_KEY = 'nexo-hub.tip-percent';

describe('PreferencesService', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  function service(): PreferencesService {
    return TestBed.inject(PreferencesService);
  }

  it('usa la ventana modal por defecto', () => {
    expect(service().dialogView()).toBe('modal');
    expect(service().formsInSidebar()).toBeFalse();
  });

  it('persiste la presentación elegida en el navegador', () => {
    const preferences = service();
    preferences.setDialogView('sidebar');

    expect(preferences.dialogView()).toBe('sidebar');
    expect(preferences.formsInSidebar()).toBeTrue();
    expect(localStorage.getItem(DIALOG_VIEW_KEY)).toBe('sidebar');
  });

  it('recupera la vista guardada y descarta valores desconocidos', () => {
    localStorage.setItem(DIALOG_VIEW_KEY, 'sidebar');
    expect(service().dialogView()).toBe('sidebar');

    localStorage.setItem(DIALOG_VIEW_KEY, 'flotante');
    TestBed.resetTestingModule();
    expect(service().dialogView()).toBe('modal');
  });

  it('mantiene una sola preferencia para caja y pedidos', () => {
    const preferences = service();
    preferences.setDialogView('sidebar');

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

    // La propina es opcional: cero es un valor válido.
    preferences.setTipPercent(0);
    expect(preferences.tipPercent()).toBe(0);
  });

  it('limita la propina sugerida a un porcentaje razonable', () => {
    const preferences = service();

    preferences.setTipPercent(180);
    expect(preferences.tipPercent()).toBe(100);

    preferences.setTipPercent(-5);
    expect(preferences.tipPercent()).toBe(0);

    preferences.setTipPercent(Number.NaN);
    expect(preferences.tipPercent()).toBe(0);
  });

  it('recupera la propina guardada y descarta valores inválidos', () => {
    localStorage.setItem(TIP_PERCENT_KEY, '12.5');
    expect(service().tipPercent()).toBe(12.5);

    localStorage.setItem(TIP_PERCENT_KEY, 'mucho');
    TestBed.resetTestingModule();
    expect(service().tipPercent()).toBe(0);

    localStorage.setItem(TIP_PERCENT_KEY, '');
    TestBed.resetTestingModule();
    expect(service().tipPercent()).toBe(DEFAULT_TIP_PERCENT);
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
