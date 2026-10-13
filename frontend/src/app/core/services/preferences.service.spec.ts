import { TestBed } from '@angular/core/testing';
import { PreferencesService } from './preferences.service';

/** Clave de `localStorage` de la preferencia (igual que en el servicio). */
const DIALOG_VIEW_KEY = 'nexo-hub.dialog-view';

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
});
