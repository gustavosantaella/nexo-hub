import { HttpClient } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { environment } from '../../../environments/environment';
import type {
  CurrenciesResponse,
  CurrencySettingPayload,
  UpdateCurrenciesPayload,
} from '../models/currencies.model';
import { RatesService } from './rates.service';

/**
 * Configuración de las monedas que el local acepta cobrar/pagar.
 *
 * La lista de monedas (con su tasa en bolívares) es parte del snapshot de
 * tasas, por eso aquí solo se guardan los cambios y se recarga `/rates`.
 */
@Injectable({ providedIn: 'root' })
export class CurrenciesService {
  private readonly http = inject(HttpClient);
  private readonly rates = inject(RatesService);
  private readonly baseUrl = `${environment.apiUrl}/currencies`;

  private readonly _saving = signal(false);
  readonly saving = this._saving.asReadonly();

  /** Monedas configuradas con su tasa en bolívares. */
  readonly currencies = computed(() => this.rates.currencies());

  /**
   * Guarda la configuración completa (y la moneda base del sistema) y refresca
   * las tasas, que son las que repintan los montos de todo el sistema.
   */
  save(
    payload: CurrencySettingPayload[],
    base: string,
    onDone?: () => void,
  ): void {
    this._saving.set(true);
    const body: UpdateCurrenciesPayload = { currencies: payload, base };
    this.http.put<CurrenciesResponse>(this.baseUrl, body).subscribe({
      next: () => {
        this._saving.set(false);
        this.rates.load(true);
        onDone?.();
      },
      error: () => this._saving.set(false),
    });
  }

  /** Quita una moneda de la configuración (USD no se puede quitar). */
  remove(code: string, onDone?: () => void): void {
    this._saving.set(true);
    this.http
      .delete<CurrenciesResponse>(`${this.baseUrl}/${code}`)
      .subscribe({
        next: () => {
          this._saving.set(false);
          this.rates.load(true);
          onDone?.();
        },
        error: () => this._saving.set(false),
      });
  }
}
