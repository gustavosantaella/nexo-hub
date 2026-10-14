/**
 * Ayudas de jerarquia de categorias (de productos y de menus). El API devuelve
 * las opciones ya ordenadas -cada principal y sus subcategorias justo debajo-,
 * asi que aqui solo se resuelve como se pintan y que abarca un filtro.
 */

/** Categoria con lo minimo para pintarla indentada en un select. */
export interface CategoryLabelOption {
  name: string;
  parentId?: string | null;
}

/** Categoria con lo minimo para ampliar un filtro a sus subcategorias. */
export interface CategoryScopeOption {
  id: string;
  parentId?: string | null;
}

/** Etiqueta de un `<option>`: las subcategorias van indentadas bajo su principal. */
export function categoryOptionLabel(category: CategoryLabelOption): string {
  return category.parentId ? `— ${category.name}` : category.name;
}

/**
 * Ids que abarca la categoria elegida en un filtro: ella y sus subcategorias.
 * Elegir "Bebidas" tambien muestra lo agrupado en "Refrescos"; elegir una
 * subcategoria muestra solo esa.
 */
export function categoryScopeIds(
  categories: readonly CategoryScopeOption[],
  selectedId: string,
): string[] {
  if (!selectedId) return [];
  const subcategories = categories.filter(
    (category) => category.parentId === selectedId,
  );
  return [selectedId, ...subcategories.map((category) => category.id)];
}
