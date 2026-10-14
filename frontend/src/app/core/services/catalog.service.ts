import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { environment } from '../../../environments/environment';
import type {
  Category,
  CategoryPayload,
  Customer,
  CustomerPayload,
  Product,
  ProductDeactivation,
  ProductOption,
  ProductPayload,
  Supplier,
  SupplierPayload,
  User,
  UserPayload,
} from '../models/api.model';
import { CrudService } from './crud.service';

/** Servicios CRUD de los recursos de catalogo y usuarios. */

@Injectable({ providedIn: 'root' })
export class ProductsService extends CrudService<Product, ProductPayload> {
  constructor(http: HttpClient) {
    super(http, 'products');
  }

  /** Productos activos para selects y POS. */
  options() {
    return this.http.get<ProductOption[]>(`${this.baseUrl}/options`);
  }

  /**
   * Baja logica del producto (mismo endpoint que un borrado, que en realidad
   * desactiva). Ademas del conteo, el API responde los menus ACTIVOS que lo usan
   * como ingrediente (`affectedMenus`): quedan sin poder venderse hasta que se
   * corrija su receta.
   */
  deactivate(id: string) {
    return this.http.delete<ProductDeactivation>(`${this.baseUrl}/${id}`);
  }
}

@Injectable({ providedIn: 'root' })
export class CategoriesService extends CrudService<Category, CategoryPayload> {
  constructor(http: HttpClient) {
    super(http, 'categories');
  }

  /** Categorias activas para selects. */
  options() {
    return this.http.get<Category[]>(`${this.baseUrl}/options`);
  }
}

@Injectable({ providedIn: 'root' })
export class SuppliersService extends CrudService<Supplier, SupplierPayload> {
  constructor(http: HttpClient) {
    super(http, 'suppliers');
  }

  options() {
    return this.http.get<Supplier[]>(`${environment.apiUrl}/suppliers/options`);
  }
}

@Injectable({ providedIn: 'root' })
export class CustomersService extends CrudService<Customer, CustomerPayload> {
  constructor(http: HttpClient) {
    super(http, 'customers');
  }

  options() {
    return this.http.get<Customer[]>(`${environment.apiUrl}/customers/options`);
  }
}

@Injectable({ providedIn: 'root' })
export class UsersService extends CrudService<User, UserPayload> {
  constructor(http: HttpClient) {
    super(http, 'users');
  }
}
