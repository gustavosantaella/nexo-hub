/**
 * Configuracion del entorno de produccion.
 *
 * El front se sirve detrás del mismo origen que la API (o de un gateway), por
 * eso `/api` y `/media` son relativos: el gateway enruta ambos prefijos al
 * backend. Así las imágenes no dependen de `localhost`, que en el navegador del
 * cliente apuntaría a su propia máquina.
 */
export const environment = {
  production: true,
  mediaUrl: '/media',
  apiUrl: '/api',
  appName: 'Nexo Hub',
};
