import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { environment } from '../../../environments/environment';
import type {
  CategorySalesReport,
  DashboardStats,
  LowStockItem,
  PaymentMethodsReport,
  PaymentsByCurrencyReport,
  SalesSeries,
  StatsQuery,
  TopProduct,
} from '../models/stats.model';
import { toHttpParams } from './crud.service';

@Injectable({ providedIn: 'root' })
export class StatsService {
  private readonly baseUrl = `${environment.apiUrl}/stats`;

  constructor(private readonly http: HttpClient) {}

  dashboard() {
    return this.http.get<DashboardStats>(`${this.baseUrl}/dashboard`);
  }

  sales(query: StatsQuery = {}) {
    return this.http.get<SalesSeries>(`${this.baseUrl}/sales`, {
      params: toHttpParams(query),
    });
  }

  topProducts(query: StatsQuery = {}) {
    return this.http.get<TopProduct[]>(`${this.baseUrl}/top-products`, {
      params: toHttpParams(query),
    });
  }

  paymentMethods(query: StatsQuery = {}) {
    return this.http.get<PaymentMethodsReport>(`${this.baseUrl}/payment-methods`, {
      params: toHttpParams(query),
    });
  }

  /** Cobros agrupados por moneda (monto original + equivalente en USD). */
  paymentsByCurrency(query: StatsQuery = {}) {
    return this.http.get<PaymentsByCurrencyReport>(
      `${this.baseUrl}/currencies`,
      { params: toHttpParams(query) },
    );
  }

  salesByCategory(query: StatsQuery = {}) {
    return this.http.get<CategorySalesReport>(`${this.baseUrl}/categories`, {
      params: toHttpParams(query),
    });
  }

  lowStock(query: StatsQuery = {}) {
    return this.http.get<LowStockItem[]>(`${this.baseUrl}/low-stock`, {
      params: toHttpParams(query),
    });
  }
}
