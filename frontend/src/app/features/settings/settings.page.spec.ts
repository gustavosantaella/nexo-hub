import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { EMPTY } from 'rxjs';
import type { Company, User } from '../../core/models/api.model';
import { AuthService } from '../../core/services/auth.service';
import { CompaniesService } from '../../core/services/companies.service';
import { CurrenciesService } from '../../core/services/currencies.service';
import { RatesService } from '../../core/services/rates.service';
import { SettingsPage } from './settings.page';

/** Tema guardado por otra prueba: se limpia antes de montar la pantalla. */
const THEME_KEY = 'nexo-hub.theme';

/** Propina sugerida guardada en el navegador (preferencia del cajero). */
const TIP_PERCENT_KEY = 'nexo-hub.tip-percent';

/** Doble mínimo de `RatesService`: aquí solo importa la navegación por pestañas. */
const ratesStub = {
  loading: signal(false),
  snapshot: signal<unknown>(null),
  bcv: signal(null),
  custom: signal(null),
  hasCustom: signal(false),
  rates: signal([]),
  currencies: signal([]),
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
 * Pruebas de las pestañas de Configuración: se pinta una sola sección a la vez y
 * se puede cambiar con el ratón o con las flechas del teclado.
 */
describe('SettingsPage (pestañas de configuración)', () => {
  let fixture: ComponentFixture<SettingsPage>;

  beforeEach(async () => {
    localStorage.removeItem(THEME_KEY);
    localStorage.removeItem(TIP_PERCENT_KEY);

    await TestBed.configureTestingModule({
      imports: [SettingsPage],
      providers: [
        provideRouter([]),
        { provide: RatesService, useValue: ratesStub },
        { provide: AuthService, useValue: authStub },
        { provide: CompaniesService, useValue: companiesStub },
        { provide: CurrenciesService, useValue: currenciesStub },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(SettingsPage);
    fixture.detectChanges();
  });

  afterEach(() => {
    document.documentElement.classList.remove('dark');
    localStorage.removeItem(THEME_KEY);
    localStorage.removeItem(TIP_PERCENT_KEY);
  });

  function tabs(): HTMLButtonElement[] {
    return Array.from(
      fixture.nativeElement.querySelectorAll('[role="tab"]') as NodeListOf<HTMLButtonElement>,
    );
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

  it('configura la propina sugerida del cajero y la guarda en el navegador', () => {
    tab('Cajero').click();
    fixture.detectChanges();

    expect(panel().id).toBe('pos-panel');
    expect(panel().textContent).toContain('Propina sugerida');

    // El 10 % viene de fábrica y es la propina que el POS propone.
    expect(panelButton('10 %').getAttribute('aria-pressed')).toBe('true');

    panelButton('15 %').click();
    fixture.detectChanges();

    expect(panelButton('15 %').getAttribute('aria-pressed')).toBe('true');
    expect(panelButton('10 %').getAttribute('aria-pressed')).toBe('false');
    expect(localStorage.getItem(TIP_PERCENT_KEY)).toBe('15');

    // La propina es opcional: cero también es una opción válida.
    panelButton('Sin propina').click();
    fixture.detectChanges();

    expect(panelButton('Sin propina').getAttribute('aria-pressed')).toBe('true');
    expect(localStorage.getItem(TIP_PERCENT_KEY)).toBe('0');
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
});
