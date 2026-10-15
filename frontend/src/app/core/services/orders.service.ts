import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { environment } from '../../../environments/environment';
import type { Paginated } from '../models/api.model';
import type {
  Order,
  OrderItemPayload,
  OrderPayload,
  OrderStatus,
  PaymentMethod,
} from '../models/operations.model';
import { toHttpParams } from './crud.service';

@Injectable({ providedIn: 'root' })
export class OrdersService {
  private readonly baseUrl = `${environment.apiUrl}/orders`;

  constructor(private readonly http: HttpClient) {}

  list(query: Record<string, unknown> = {}) {
    return this.http.get<Paginated<Order>>(this.baseUrl, {
      params: toHttpParams(query),
    });
  }

  /** Tablero operativo (pedidos no terminados). */
  active() {
    return this.http.get<Order[]>(`${this.baseUrl}/active`);
  }

  get(id: string) {
    return this.http.get<Order>(`${this.baseUrl}/${id}`);
  }

  create(payload: OrderPayload) {
    return this.http.post<Order>(this.baseUrl, payload);
  }

  update(id: string, payload: Partial<OrderPayload>) {
    return this.http.patch<Order>(`${this.baseUrl}/${id}`, payload);
  }

  /**
   * Agrega productos a un pedido existente (descuenta stock y recalcula los
   * totales). El backend fusiona los productos repetidos en una sola linea y
   * rechaza la operacion en pedidos completados o cancelados.
   */
  addItems(id: string, items: OrderItemPayload[]) {
    return this.http.post<Order>(`${this.baseUrl}/${id}/items`, { items });
  }

  /**
   * Corrige la cantidad de una linea ya guardada en el pedido. El backend
   * ajusta el stock por la diferencia (consume lo agregado o devuelve lo
   * quitado) y recalcula los totales.
   */
  updateItem(id: string, itemId: string, quantity: number) {
    return this.http.patch<Order>(`${this.baseUrl}/${id}/items/${itemId}`, {
      quantity,
    });
  }

  /** Quita un producto del pedido; el backend devuelve su stock al inventario. */
  removeItem(id: string, itemId: string) {
    return this.http.delete<Order>(`${this.baseUrl}/${id}/items/${itemId}`);
  }

  updateStatus(id: string, status: OrderStatus) {
    return this.http.patch<Order>(`${this.baseUrl}/${id}/status`, { status });
  }

  /**
   * Registra un cobro del pedido (impacta la caja abierta).
   * `amount` va en la moneda del cobro (`currency`); el backend guarda ademas
   * su equivalente en la moneda base. `rateKey` es la **tasa de cobro** con la
   * que se convierte ese monto (la que fijo la empresa en Configuracion → Cajero):
   * el cajero cobra el precio que ve en pantalla, asi que con una tasa de cobro
   * distinta de la activa el cobro puede valer mas que el total del pedido.
   */
  pay(
    id: string,
    payload: {
      amount: number;
      method: PaymentMethod;
      currency?: string;
      rateKey?: string;
      note?: string;
    },
  ) {
    return this.http.post<Order>(`${this.baseUrl}/${id}/payments`, payload);
  }

  remove(id: string) {
    return this.http.delete<{ id: string }>(`${this.baseUrl}/${id}`);
  }
}
