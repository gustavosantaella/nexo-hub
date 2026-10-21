import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { routes } from '../../app.routes';
import { PosPage } from './pos.page';

/**
 * La vista del cajero es una pagina propia, montada en `/panel/caja/pos`: al
 * salir del POS debe volver al arqueo de Caja.
 */
describe('PosPage', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PosPage],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
      ],
    }).compileComponents();
  });

  it('se monta en la ruta caja/pos del panel', () => {
    const panel = routes.find((route) => route.path === 'panel');
    const pos = panel?.children?.find((route) => route.path === 'caja/pos');

    expect(pos).toBeDefined();
    expect(pos?.title).toContain('Punto de venta');
  });

  it('vuelve al arqueo de caja al salir del POS', () => {
    const router = TestBed.inject(Router);
    const navigate = spyOn(router, 'navigate').and.resolveTo(true);
    const page = TestBed.createComponent(PosPage).componentInstance;

    page.close();

    expect(navigate).toHaveBeenCalledWith(['/panel/caja']);
  });
});
