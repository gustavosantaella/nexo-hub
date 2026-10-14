/**
 * Las categorias (de productos y de menus) admiten UN nivel de subcategorias:
 * una categoria con `parentId` es subcategoria de otra principal y una principal
 * nunca tiene padre. Estos helpers concentran las dos operaciones que comparten
 * los dos modulos: ordenar para los selects y saber si un nombre esta repetido
 * dentro del mismo grupo.
 */

/** Forma minima de una categoria con jerarquia. */
export interface CategoryHierarchyRow {
  id: string;
  name: string;
  parentId: string | null;
}

/** Nombres ordenados alfabeticamente (mismo criterio en toda la app). */
function byName(a: { name: string }, b: { name: string }): number {
  return a.name.localeCompare(b.name);
}

/**
 * Ordena las categorias para un `<option>`: primero las principales (A-Z) y
 * justo debajo las subcategorias de cada una (A-Z). Asi la interfaz solo tiene
 * que indentar las filas que traen `parentId`.
 *
 * `compare` permite a los menus ordenar por su `sortOrder` en lugar de por
 * nombre. Las subcategorias cuya principal no viene en la lista (por ejemplo
 * porque esta inactiva) se dejan al final para no perderlas.
 */
export function sortCategoryHierarchy<T extends CategoryHierarchyRow>(
  rows: readonly T[],
  compare: (a: T, b: T) => number = byName,
): T[] {
  const ordered: T[] = [];
  const taken = new Set<string>();

  for (const root of rows.filter((row) => !row.parentId).sort(compare)) {
    ordered.push(root);
    taken.add(root.id);
    for (const child of rows
      .filter((row) => row.parentId === root.id)
      .sort(compare)) {
      ordered.push(child);
      taken.add(child.id);
    }
  }

  // Huerfanas: su principal no esta en la lista (inactiva, por ejemplo).
  ordered.push(...rows.filter((row) => !taken.has(row.id)).sort(compare));

  return ordered;
}
