/**
 * Configuracion del entorno de desarrollo.
 *
 * `apiUrl` es relativo a proposito:
 *  - En desarrollo, `ng serve` reenvia /api y /media al backend (:3000) segun
 *    `proxy.conf.json`, asi que no hay problemas de CORS ni de puerto.
 *  - En produccion se usa `environment.prod.ts`, donde `mediaUrl` es `/media`
 *    (el gateway lo enruta al backend igual que /api).
 * Para apuntar a otro host, basta con cambiarlo aqui o anadir
 * un `fileReplacements` por configuracion en angular.json.
 *
 * `mediaUrl` es la base con la que se pintan las rutas locales `/media/...`
 * guardadas en la base de datos (ver `resolveMediaUrl`).
 */
export const environment = {
  production: false,
  mediaUrl: 'http://localhost:3000/media',
  apiUrl: 'http://localhost:3000/api',
  appName: 'Nexo Hub',
};
