/**
 * Configuracion del entorno.
 *
 * `apiUrl` es relativo a proposito:
 *  - En desarrollo, `ng serve` reenvia /api al backend (:3000) segun
 *    `proxy.conf.json`, asi que no hay problemas de CORS ni de puerto.
 *  - En produccion, el front se sirve detras del mismo origen que la API
 *    (o de un gateway) y el prefijo /api sigue siendo valido.
 * Para apuntar a otro host, basta con cambiarlo aqui o anadir
 * un `fileReplacements` por configuracion en angular.json.
 */
export const environment = {
  production: false,
  apiUrl: '/api',
  appName: 'Nexo Hub',
};
