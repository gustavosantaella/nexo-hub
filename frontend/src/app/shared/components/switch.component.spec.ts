import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { SwitchComponent } from './switch.component';

/**
 * Interruptor reutilizable: estado controlado, aviso al pulsar y etiqueta/pista
 * visibles (y clicables).
 */
describe('SwitchComponent (interruptor reutilizable)', () => {
  let fixture: ComponentFixture<SwitchComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SwitchComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(SwitchComponent);
  });

  /** Pinta el interruptor con el estado indicado. */
  function render(checked: boolean): HTMLElement {
    fixture.componentRef.setInput('checked', checked);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  function control(root: HTMLElement): HTMLButtonElement {
    const found = root.querySelector('button[role="switch"]');
    if (!found) throw new Error('No se encontró el interruptor');
    return found as HTMLButtonElement;
  }

  it('arranca apagado y avisa cuando se enciende', () => {
    const emitted: boolean[] = [];
    fixture.componentInstance.checkedChange.subscribe((value) => emitted.push(value));

    const root = render(false);

    expect(control(root).getAttribute('aria-checked')).toBe('false');
    expect(control(root).classList).toContain('bg-slate-300');

    control(root).click();
    fixture.detectChanges();

    // Es controlado: no cambia solo, solo avisa.
    expect(emitted).toEqual([true]);
    expect(control(root).getAttribute('aria-checked')).toBe('false');
  });

  it('avisa que se apaga cuando está encendido', () => {
    const emitted: boolean[] = [];
    fixture.componentInstance.checkedChange.subscribe((value) => emitted.push(value));

    const root = render(true);

    expect(control(root).classList).toContain('bg-brand-600');
    // La bolita se desliza a la derecha cuando está encendido.
    expect(root.querySelector('button > span')?.classList).toContain('translate-x-4');

    control(root).click();
    expect(emitted).toEqual([false]);
  });

  it('muestra la etiqueta y la pista, y el texto también enciende', () => {
    const emitted: boolean[] = [];
    fixture.componentInstance.checkedChange.subscribe((value) => emitted.push(value));

    fixture.componentRef.setInput('label', 'Mostrar la conversión en Dólares (USD)');
    fixture.componentRef.setInput('hint', 'Con la tasa del BCV.');
    const root = render(false);

    expect(root.textContent).toContain('Mostrar la conversión en Dólares (USD)');
    expect(root.textContent).toContain('Con la tasa del BCV.');
    // El nombre accesible sale de la etiqueta visible.
    expect(control(root).getAttribute('aria-label')).toBe(
      'Mostrar la conversión en Dólares (USD)',
    );

    const text = root.querySelector('div > span') as HTMLElement;
    text.click();

    expect(emitted).toEqual([true]);
  });

  it('no emite nada cuando está deshabilitado', () => {
    const emitted: boolean[] = [];
    fixture.componentInstance.checkedChange.subscribe((value) => emitted.push(value));

    fixture.componentRef.setInput('disabled', true);
    fixture.componentRef.setInput('label', 'Mostrar la conversión en Dólares (USD)');
    const root = render(false);

    expect(control(root).disabled).toBeTrue();
    control(root).click();
    (root.querySelector('div > span') as HTMLElement).click();

    expect(emitted).toEqual([]);
  });

  it('acepta un nombre accesible propio cuando no hay etiqueta visible', () => {
    fixture.componentRef.setInput('ariaLabel', 'Activar las conversiones');
    const root = render(true);

    expect(root.textContent?.trim()).toBe('');
    expect(control(root).getAttribute('aria-label')).toBe('Activar las conversiones');
  });
});
