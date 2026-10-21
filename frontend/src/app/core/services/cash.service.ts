import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { environment } from '../../../environments/environment';
import type { Paginated } from '../models/api.model';
import type {
  CashCurrentResponse,
  CashMovement,
  CashMovementPayload,
  CashSession,
} from '../models/operations.model';
import { toHttpParams } from './crud.service';

@Injectable({ providedIn: 'root' })
export class CashService {
  private readonly baseUrl = `${environment.apiUrl}/cash`;

  constructor(private readonly http: HttpClient) {}

  /**
   * Sesion abierta + arqueo en vivo.
   * El backend devuelve `{ session: null, summary: null }` cuando la caja
   * esta cerrada, o la sesion (con `summary`) cuando esta abierta.
   */
  current() {
    return this.http.get<CashCurrentResponse | CashSession | null>(
      `${this.baseUrl}/current`,
    );
  }

  open(payload: {
    /** Fondo total en la moneda base (se calcula solo si se envían líneas). */
    openingAmount?: number;
    /** Moneda en la que se cuenta el fondo inicial (USD por defecto). */
    openingCurrency?: string;
    /**
     * Fondo contado en varias monedas a la vez (ej. 100 USD + 5.000 Bs + 50 EUR).
     * Tiene prioridad sobre `openingAmount`: el total se suma en la moneda base.
     */
    openingLines?: { currency: string; amount: number }[];
    openingNotes?: string;
  }) {
    return this.http.post<CashSession>(`${this.baseUrl}/open`, payload);
  }

  close(payload: {
    countedAmount: number;
    /** Moneda en la que se cuenta el efectivo al cerrar (USD por defecto). */
    countedCurrency?: string;
    closingNotes?: string;
  }) {
    return this.http.post<CashSession>(`${this.baseUrl}/close`, payload);
  }

  addMovement(payload: CashMovementPayload) {
    return this.http.post<
      CashMovement | { movements: CashMovement[]; count: number }
    >(`${this.baseUrl}/movements`, payload);
  }

  movements(query: Record<string, unknown> = {}) {
    return this.http.get<Paginated<CashMovement>>(`${this.baseUrl}/movements`, {
      params: toHttpParams(query),
    });
  }

  sessions(query: Record<string, unknown> = {}) {
    return this.http.get<Paginated<CashSession>>(`${this.baseUrl}/sessions`, {
      params: toHttpParams(query),
    });
  }

  session(id: string) {
    return this.http.get<CashSession>(`${this.baseUrl}/sessions/${id}`);
  }
}
