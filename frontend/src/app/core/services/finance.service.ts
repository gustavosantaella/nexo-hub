import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { environment } from '../../../environments/environment';
import type { Paginated } from '../models/api.model';
import type {
  AccountPayment,
  AccountPaymentPayload,
  AccountPayload,
  AccountSummary,
  Expense,
  ExpensePayload,
  ExpenseSummary,
  Payable,
  Receivable,
} from '../models/finance.model';
import { toHttpParams } from './crud.service';

/** Gastos operativos. */
@Injectable({ providedIn: 'root' })
export class ExpensesService {
  private readonly baseUrl = `${environment.apiUrl}/expenses`;

  constructor(private readonly http: HttpClient) {}

  list(query: Record<string, unknown> = {}) {
    return this.http.get<Paginated<Expense>>(this.baseUrl, {
      params: toHttpParams(query),
    });
  }

  get(id: string) {
    return this.http.get<Expense>(`${this.baseUrl}/${id}`);
  }

  summary(query: Record<string, unknown> = {}) {
    return this.http.get<ExpenseSummary>(`${this.baseUrl}/summary`, {
      params: toHttpParams(query),
    });
  }

  create(payload: ExpensePayload) {
    return this.http.post<Expense>(this.baseUrl, payload);
  }

  update(id: string, payload: Partial<ExpensePayload>) {
    return this.http.patch<Expense>(`${this.baseUrl}/${id}`, payload);
  }

  remove(id: string) {
    return this.http.delete<{ id: string }>(`${this.baseUrl}/${id}`);
  }
}

/** Cuentas por pagar (a proveedores). */
@Injectable({ providedIn: 'root' })
export class PayablesService {
  private readonly baseUrl = `${environment.apiUrl}/payables`;

  constructor(private readonly http: HttpClient) {}

  list(query: Record<string, unknown> = {}) {
    return this.http.get<Paginated<Payable>>(this.baseUrl, {
      params: toHttpParams(query),
    });
  }

  get(id: string) {
    return this.http.get<Payable>(`${this.baseUrl}/${id}`);
  }

  summary() {
    return this.http.get<AccountSummary>(`${this.baseUrl}/summary`);
  }

  create(payload: AccountPayload) {
    return this.http.post<Payable>(this.baseUrl, payload);
  }

  update(id: string, payload: Partial<AccountPayload>) {
    return this.http.patch<Payable>(`${this.baseUrl}/${id}`, payload);
  }

  /** Registra un abono (egresa de caja si el metodo es efectivo). */
  pay(id: string, payload: AccountPaymentPayload) {
    return this.http.post<AccountPayment>(`${this.baseUrl}/${id}/payments`, payload);
  }

  cancel(id: string) {
    return this.http.post<Payable>(`${this.baseUrl}/${id}/cancel`, {});
  }

  remove(id: string) {
    return this.http.delete<{ id: string }>(`${this.baseUrl}/${id}`);
  }
}

/** Cuentas por cobrar (de clientes). */
@Injectable({ providedIn: 'root' })
export class ReceivablesService {
  private readonly baseUrl = `${environment.apiUrl}/receivables`;

  constructor(private readonly http: HttpClient) {}

  list(query: Record<string, unknown> = {}) {
    return this.http.get<Paginated<Receivable>>(this.baseUrl, {
      params: toHttpParams(query),
    });
  }

  get(id: string) {
    return this.http.get<Receivable>(`${this.baseUrl}/${id}`);
  }

  summary() {
    return this.http.get<AccountSummary>(`${this.baseUrl}/summary`);
  }

  create(payload: AccountPayload) {
    return this.http.post<Receivable>(this.baseUrl, payload);
  }

  update(id: string, payload: Partial<AccountPayload>) {
    return this.http.patch<Receivable>(`${this.baseUrl}/${id}`, payload);
  }

  /** Registra un cobro (ingresa a caja si el metodo es efectivo). */
  collect(id: string, payload: AccountPaymentPayload) {
    return this.http.post<AccountPayment>(
      `${this.baseUrl}/${id}/payments`,
      payload,
    );
  }

  cancel(id: string) {
    return this.http.post<Receivable>(`${this.baseUrl}/${id}/cancel`, {});
  }

  remove(id: string) {
    return this.http.delete<{ id: string }>(`${this.baseUrl}/${id}`);
  }
}
