import { categoryOptionLabel, categoryScopeIds } from './category-tree';

describe('categoryOptionLabel', () => {
  it('deja el nombre tal cual en una categoria principal', () => {
    expect(categoryOptionLabel({ name: 'Bebidas', parentId: null })).toBe(
      'Bebidas',
    );
  });

  it('indenta las subcategorias bajo su principal', () => {
    expect(categoryOptionLabel({ name: 'Refrescos', parentId: 'c1' })).toBe(
      '— Refrescos',
    );
  });
});

describe('categoryScopeIds', () => {
  const CATEGORIES = [
    { id: 'bebidas', parentId: null },
    { id: 'refrescos', parentId: 'bebidas' },
    { id: 'cervezas', parentId: 'bebidas' },
    { id: 'comidas', parentId: null },
  ];

  it('abarca la categoria elegida y sus subcategorias', () => {
    expect(categoryScopeIds(CATEGORIES, 'bebidas')).toEqual([
      'bebidas',
      'refrescos',
      'cervezas',
    ]);
  });

  it('no arrastra las de otras categorias cuando se elige una subcategoria', () => {
    expect(categoryScopeIds(CATEGORIES, 'refrescos')).toEqual(['refrescos']);
  });

  it('sin filtro no abarca ninguna categoria', () => {
    expect(categoryScopeIds(CATEGORIES, '')).toEqual([]);
  });
});
