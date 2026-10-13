import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ConfirmService } from '../services/confirm.service';
import { ConfirmHostComponent } from './confirm-host.component';

/**
 * Regresion: el host global debe renderizar el dialogo y resolver la promesa
 * de `ConfirmService.ask()` (sin el host, "Cerrar sesión" y todas las acciones
 * destructivas quedaban colgadas).
 */
describe('ConfirmHostComponent', () => {
  let fixture: ComponentFixture<ConfirmHostComponent>;
  let confirm: ConfirmService;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ConfirmHostComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(ConfirmHostComponent);
    confirm = TestBed.inject(ConfirmService);
    fixture.detectChanges();
  });

  function buttons(): HTMLButtonElement[] {
    const found: NodeListOf<HTMLButtonElement> =
      fixture.nativeElement.querySelectorAll('button');
    return Array.from(found);
  }

  it('no renderiza nada mientras no haya una confirmacion pendiente', () => {
    expect(fixture.nativeElement.querySelector('.fixed')).toBeNull();
  });

  it('resuelve true al aceptar y cierra el dialogo', async () => {
    const answer = confirm.ask({
      title: 'Cerrar sesión',
      message: '¿Deseas salir del sistema?',
      confirmLabel: 'Cerrar sesión',
    });
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('¿Deseas salir del sistema?');
    expect(buttons().length).toBe(2);

    buttons()[1].click();
    await expectAsync(answer).toBeResolvedTo(true);

    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).not.toContain('¿Deseas salir del sistema?');
  });

  it('resuelve false al cancelar', async () => {
    const answer = confirm.ask({ message: '¿Eliminar registro?' });
    fixture.detectChanges();

    buttons()[0].click();
    await expectAsync(answer).toBeResolvedTo(false);
  });

  it('resuelve false con la tecla Escape', async () => {
    const answer = confirm.ask({ message: '¿Cancelar pedido?' });
    fixture.detectChanges();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await expectAsync(answer).toBeResolvedTo(false);
  });

  it('resuelve la promesa anterior como false si se abre otra confirmacion', async () => {
    const first = confirm.ask({ message: 'Primera' });
    const second = confirm.ask({ message: 'Segunda' });
    fixture.detectChanges();

    await expectAsync(first).toBeResolvedTo(false);
    await expectAsync(second).toBePending();

    confirm.resolve(true);
    await expectAsync(second).toBeResolvedTo(true);
  });
});
