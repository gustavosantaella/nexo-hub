import { TestBed } from '@angular/core/testing';
import { LayoutService } from './layout.service';

describe('LayoutService', () => {
  function service(): LayoutService {
    return TestBed.inject(LayoutService);
  }

  it('arranca con el shell visible (sin pantalla completa)', () => {
    expect(service().fullscreen()).toBeFalse();
  });

  it('activa y desactiva la pantalla completa', () => {
    const layout = service();

    layout.setFullscreen(true);
    expect(layout.fullscreen()).toBeTrue();

    layout.setFullscreen(false);
    expect(layout.fullscreen()).toBeFalse();
  });

  it('comparte el estado entre consumidores (servicio singleton)', () => {
    service().setFullscreen(true);
    expect(TestBed.inject(LayoutService).fullscreen()).toBeTrue();
  });
});
