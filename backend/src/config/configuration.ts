/**
 * Configuracion central de la aplicacion.
 * Todas las variables de entorno se leen aqui una sola vez y se exponen
 * tipadas al resto de la app a traves de ConfigService.
 */
export interface AppConfig {
  env: string;
  isProduction: boolean;
  port: number;
  apiPrefix: string;
  corsOrigins: string[];
  jwt: {
    secret: string;
    expiresIn: string;
  };
  cash: {
    /** Si es true solo se permite UNA sesion de caja abierta en todo el sistema. */
    singleOpenSession: boolean;
  };
  telegram: {
    /** Token del bot creado en BotFather. Vacio = bot deshabilitado. */
    botToken: string;
    /**
     * Escucha los mensajes del bot con `getUpdates` para vincular el chat del
     * administrador (`/vincular CODIGO`). Se apaga en las pruebas.
     */
    polling: boolean;
  };
  rates: {
    /** Endpoint publico del BCV (dolarvzla) que devuelve la tasa del dia. */
    bcvUrl: string;
    /** Segundos que se reutiliza la respuesta del BCV antes de volver a consultarla. */
    cacheTtlSeconds: number;
    /** Tiempo maximo de espera de la consulta externa (ms). */
    timeoutMs: number;
    /**
     * Endpoint informativo con la tasa USDT/VES (no se usa para convertir
     * montos; solo se muestra como referencia en Configuracion).
     */
    usdtUrl: string;
    /** Segundos que se reutiliza la respuesta de la tasa USDT de referencia. */
    usdtCacheTtlSeconds: number;
  };
}

const toBool = (value: string | undefined, fallback = false): boolean => {
  if (value === undefined) return fallback;
  return ['true', '1', 'yes', 'on'].includes(value.toLowerCase());
};

export default (): AppConfig => {
  const env = process.env.NODE_ENV ?? 'development';

  return {
    env,
    isProduction: env === 'production',
    port: parseInt(process.env.PORT ?? '3000', 10),
    apiPrefix: process.env.API_PREFIX ?? 'api',
    corsOrigins: (
      process.env.CORS_ORIGINS ?? 'http://localhost:4200,http://localhost:5173'
    )
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
    jwt: {
      secret: process.env.JWT_SECRET ?? 'nexo-hub-dev-secret',
      expiresIn: process.env.JWT_EXPIRES_IN ?? '12h',
    },
    cash: {
      singleOpenSession: toBool(process.env.CASH_SINGLE_OPEN_SESSION, true),
    },
    telegram: {
      botToken: process.env.TELEGRAM_BOT_API_TOKEN ?? '',
      polling:
        env !== 'test' &&
        toBool(process.env.TELEGRAM_POLLING, true),
    },
    rates: {
      bcvUrl:
        process.env.RATES_BCV_URL ??
        'https://rates.dolarvzla.com/bcv/current.json',
      cacheTtlSeconds: parseInt(process.env.RATES_CACHE_TTL_SECONDS ?? '900', 10),
      timeoutMs: parseInt(process.env.RATES_TIMEOUT_MS ?? '8000', 10),
      usdtUrl:
        process.env.RATES_USDT_URL ??
        'https://fx.vexwallet.co/api/v1/fx/latest?pair=USDT/VES&source=binance&method=p2p_floor',
      usdtCacheTtlSeconds: parseInt(
        process.env.RATES_USDT_CACHE_TTL_SECONDS ?? '300',
        10,
      ),
    },
  };
};
