import { sortCategoryHierarchy } from './category-hierarchy.util';

/** Fila minima de categoria para las pruebas. */
function row(id: string, name: string, parentId: string | null = null) {
  return { id, name, parentId };
}

describe('sortCategoryHierarchy', () => {
  it('deja cada subcategoria justo debajo de su principal', () => {
    const ordered = sortCategoryHierarchy([
      row('c1', 'Refrescos', 'cat-bebidas'),
      row('cat-postres', 'Postres'),
      row('cat-bebidas', 'Bebidas'),
      row('c2', 'Cervezas', 'cat-bebidas'),
    ]);

    expect(ordered.map((item) => item.name)).toEqual([
      'Bebidas',
      'Cervezas',
      'Refrescos',
      'Postres',
    ]);
  });

  it('deja al final las subcategorias cuya principal no viene en la lista', () => {
    const ordered = sortCategoryHierarchy([
      row('c1', 'Refrescos', 'cat-bebidas'),
      row('cat-bebidas', 'Bebidas'),
    ]);

    expect(ordered.map((item) => item.id)).toEqual(['cat-bebidas', 'c1']);
  });

  it('acepta un comparador propio (los menus ordenan por sortOrder)', () => {
    const ordered = sortCategoryHierarchy(
      [
        { id: 'c1', name: 'Sopas', parentId: 'cat-almuerzos', sortOrder: 2 },
        { id: 'cat-combos', name: 'Combos', parentId: null, sortOrder: 1 },
        { id: 'cat-almuerzos', name: 'Almuerzos', parentId: null, sortOrder: 2 },
        { id: 'c2', name: 'Cremas', parentId: 'cat-almuerzos', sortOrder: 1 },
      ],
      (a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name),
    );

    expect(ordered.map((item) => item.name)).toEqual([
      'Combos',
      'Almuerzos',
      'Cremas',
      'Sopas',
    ]);
  });
});
