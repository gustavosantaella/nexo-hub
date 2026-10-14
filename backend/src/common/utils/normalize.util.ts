/**
 * Normaliza identificadores opcionales que llegan desde formularios:
 * cadena vacia, "null" o undefined => null (evita FKs invalidas en Prisma).
 */
export function normalizeNullableId(value?: string | null): string | null {
  if (value == null) return null;
  const trimmed = String(value).trim();
  if (trimmed === '' || trimmed === 'null' || trimmed === 'undefined') return null;
  return trimmed;
}

/**
 * La foto/logo vacio se guarda como `null` (asi el formulario puede quitarla).
 * Aplica a productos, menus y logos: cualquier imagen opcional.
 */
export function normalizeImageUrl(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}
