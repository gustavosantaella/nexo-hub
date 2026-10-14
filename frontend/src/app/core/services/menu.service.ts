import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import type {
  Menu,
  MenuCategory,
  MenuCategoryPayload,
  MenuCategoryRef,
  MenuOption,
  MenuPayload,
} from '../models/api.model';
import { CrudService } from './crud.service';

/** Servicios CRUD de los recursos del MENU (platos/combos y sus categorias). */

@Injectable({ providedIn: 'root' })
export class MenusService extends CrudService<Menu, MenuPayload> {
  constructor(http: HttpClient) {
    super(http, 'menus');
  }

  /**
   * Menus activos con su receta y su disponibilidad, para la grilla del POS y el
   * buscador de pedidos.
   */
  options() {
    return this.http.get<MenuOption[]>(`${this.baseUrl}/options`);
  }
}

@Injectable({ providedIn: 'root' })
export class MenuCategoriesService extends CrudService<
  MenuCategory,
  MenuCategoryPayload
> {
  constructor(http: HttpClient) {
    super(http, 'menu-categories');
  }

  /** Categorias de menu activas para selects y filtros. */
  options() {
    return this.http.get<MenuCategoryRef[]>(`${this.baseUrl}/options`);
  }
}
