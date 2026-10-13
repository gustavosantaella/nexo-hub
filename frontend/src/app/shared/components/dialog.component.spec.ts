import { ChangeDetectionStrategy, Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { DialogComponent } from './dialog.component';

/**
 * Host de prueba: pasa cuerpo y pie como plantillas, igual que las páginas que
 * usan `<app-dialog>`.
 */
@Component({
  standalone: true,
  imports: [DialogComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-dialog
      [open]="open"
      [variant]="variant"
      title="Registrar movimiento"
      subtitle="Entradas y salidas de efectivo"
      [body]="body"
      [footer]="footer"
      (closed)="closes = closes + 1"
    />

    <ng-template #body>
      <p class="body-marker">Cuerpo del formulario</p>
    </ng-template>
    <ng-template #footer>
      <button type="button" class="footer-marker" (click)="saved = true">Registrar</button>
    </ng-template>
  `,
})
class HostComponent {
  open = true;
  variant: 'modal' | 'sidebar' = 'modal';
  closes = 0;
  saved = false;
}

describe('DialogComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [HostComponent] }).compileComponents();
  });

  function mount(variant: 'modal' | 'sidebar', open = true) {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.componentInstance.variant = variant;
    fixture.componentInstance.open = open;
    fixture.detectChanges();
    return fixture;
  }

  it('dibuja cuerpo y pie dentro de la ventana modal', () => {
    const fixture = mount('modal');
    const root: HTMLElement = fixture.nativeElement;
    const body = root.querySelector('.body-marker')!;
    const footer = root.querySelector('.footer-marker')!;

    expect(root.querySelector('app-modal')).not.toBeNull();
    expect(root.querySelector('app-sidebar')).toBeNull();
    // El contenido queda dentro de la ventana, no suelto en la página.
    expect(body.closest('app-modal')).not.toBeNull();
    // El pie va en la barra inferior del diálogo, no junto al cuerpo.
    expect(footer.closest('.dialog-footer')!.closest('app-modal')).not.toBeNull();
    expect(body.closest('.dialog-footer')).toBeNull();
  });

  it('dibuja el mismo cuerpo y pie dentro del panel lateral', () => {
    const fixture = mount('sidebar');
    const root: HTMLElement = fixture.nativeElement;
    const body = root.querySelector('.body-marker')!;
    const footer = root.querySelector('.footer-marker')!;

    expect(root.querySelector('app-sidebar aside')).not.toBeNull();
    expect(root.querySelector('app-modal')).toBeNull();
    expect(body.closest('aside')).not.toBeNull();
    expect(footer.closest('.dialog-footer')!.closest('aside')).not.toBeNull();
    expect(body.closest('.dialog-footer')).toBeNull();

    // El contenido proyectado sigue respondiendo al host (no pierde bindings).
    (footer as HTMLButtonElement).click();
    expect(fixture.componentInstance.saved).toBe(true);
  });

  it('emite closed al cerrar el panel lateral', () => {
    const fixture = mount('sidebar');
    const close: HTMLButtonElement = fixture.nativeElement.querySelector(
      'app-sidebar aside button[aria-label="Cerrar"]',
    );
    close.click();

    expect(fixture.componentInstance.closes).toBe(1);
  });

  it('no instancia el contenido mientras está cerrado', () => {
    const fixture = mount('modal', false);

    expect(fixture.nativeElement.querySelector('.body-marker')).toBeNull();
    expect(fixture.nativeElement.querySelector('.footer-marker')).toBeNull();
  });
});
