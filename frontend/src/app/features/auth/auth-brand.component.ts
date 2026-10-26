import { ChangeDetectionStrategy, Component, Input } from '@angular/core';
import { IconComponent } from '../../shared/components/icon.component';

/** Viñeta de valor mostrada en el panel de marca. */
export interface AuthBrandFeature {
  icon: string;
  title: string;
  description: string;
}

/**
 * Panel de marca compartido por las pantallas de acceso (login y registro).
 *
 * Es decorativo: no conoce la sesión ni la navegación, solo recibe el discurso
 * y las ventajas que acompañan al formulario.
 */
@Component({
  selector: 'app-auth-brand',
  standalone: true,
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './auth-brand.component.html',
  styleUrl: './auth-ui.scss',
  styles: [':host { display: block; height: 100%; }'],
})
export class AuthBrandComponent {
  @Input() eyebrow = 'Plataforma multi-empresa';
  @Input() eyebrowIcon = 'sparkles';
  @Input() headline = '';
  @Input() description = '';
  @Input() features: readonly AuthBrandFeature[] = [];

  readonly year = new Date().getFullYear();
}
