import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { environment } from '../../../environments/environment';
import type { Paginated } from '../models/api.model';
import type {
  MovementPayload,
  MovementResult,
  StockLevel,
  StockMovement,
} from '../models/operations.model';
import { toHttpParams } from './crud.service';

@Injectable({ providedIn: 'root' })
export class InventoryService {
  private readonly baseUrl = `${environment.apiUrl}/inventory`;

  constructor(private readonly http: HttpClient) {}

  /** Registra un movimiento de entrada / salida / ajuste. */
  createMovement(payload: MovementPayload) {
    return this.http.post<MovementResult>(`${this.baseUrl}/movements`, payload);
  }

  movements(query: Record<string, unknown> = {}) {
    return this.http.get<Paginated<StockMovement>>(`${this.baseUrl}/movements`, {
      params: toHttpParams(query),
    });
  }

  /** Niveles de stock (con filtro opcional de bajo stock y busqueda). */
  stock(options: { lowOnly?: boolean; search?: string } = {}) {
    return this.http.get<StockLevel[]>(`${this.baseUrl}/stock`, {
      params: toHttpParams(options),
    });
  }

  lowStock() {
    return this.http.get<StockLevel[]>(`${this.baseUrl}/low-stock`);
  }

  /** Fija el stock de un producto a un valor final (crea el ajuste). */
  adjust(
    productId: string,
    payload: {
      newStock: number;
      /** Unidad con la que se conto el stock final (cajas, kg, unidades...). */
      inputUnit?: string;
      /** Stock final tal como se conto, en `inputUnit`. */
      inputQuantity?: number;
      reason?: string;
    },
  ) {
    return this.http.post<MovementResult>(
      `${this.baseUrl}/products/${productId}/adjust`,
      payload,
    );
  }
}
