import { HttpClient } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { environment } from '../../../environments/environment';
import {
  BASE_CURRENCY,
  BASE_CURRENCY_CODE,
  CHARGE_RATE_KEY,
  LOCAL_CURRENCY_CODE,
  RATE_META,
  currencyMeta,
  rateSourceLabel,
} from '../constants/currency';
import type {
  BaseCurrencyInfo,
  CurrencyRateOption,
  CustomRate,
  RateConversion,
  RateKey,
  RatesSnapshot,
  ReferenceRate,
} from '../models/rates.model';
import { bs, displayBaseCode, money, moneyIn, setDisplayCurrency } from '../utils/format';
import type { DisplayCurrency } from '../utils/format';
import { sessionChanges, storedCanManage, storedIsCashier } from '../auth/session';
import { PreferencesService } from './preferences.service';

/** Redondeo monetario (2 decimales) equivalente al del backend. */
function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/** Moneda base mientras las tasas aún no se han cargado (dólares). */
const DEFAULT_BASE_CURRENCY: BaseCurrencyInfo = {
  code: BASE_CURRENCY.code,
  label: BASE_CURRENCY.label,
  symbol: BASE_CURRENCY.symbol,
  decimals: 2,
  bsPerUnit: null,
  bsPerUsd: 0,
};

/** Preferencia local: mostrar los montos "al cambio" en todo el sistema. */
const CONVERSIONS_KEY = 'nexo-hub.rate-conversions';

/**
 * Clave de la tasa oficial del dólar (`BCV_USD`): es la línea de **precio en
 * dólares del BCV** que el admin puede activar debajo de cada monto
 * (Configuración → Cajero) y con la que se evita repetirla dos veces.
 */
export const BCV_USD_RATE_KEY: RateKey = 'BCV_USD';

function storedConversions(): boolean {
  try {
    return localStorage.getItem(CONVERSIONS_KEY) !== '0';
  } catch {
    return true;
  }
}

/**
 * Tasas de cambio del BCV (dólar y euro) + tasa personalizada del local.
 *
 * El backend consulta `https://rates.dolarvzla.com/bcv/current.json`, cachea la
 * respuesta y persiste la tasa personalizada; aquí solo se mantiene el estado
 * reactivo (signals) que usan `<app-money>` y el módulo de configuración.
 *
 * También expone la tasa **USDT/VES de referencia** publicada por Binance P2P:
 * es informativa y no participa en ninguna conversión.
 */
@Injectable({ providedIn: 'root' })
export class RatesService {
  private readonly http = inject(HttpClient);
  private readonly preferences = inject(PreferencesService);
  private readonly baseUrl = `${environment.apiUrl}/rates`;

  private readonly _snapshot = signal<RatesSnapshot | null>(null);
  private readonly _loading = signal(false);
  private readonly _error = signal<string | null>(null);
  private readonly _conversions = signal(storedConversions());
  /** Última petición lanzada (para ignorar respuestas obsoletas). */
  private requestId = 0;

  readonly snapshot = this._snapshot.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly error = this._error.asReadonly();
  /** Interruptor global de los montos "al cambio". */
  readonly showConversions = this._conversions.asReadonly();

  /**
   * Monedas cuyas conversiones puede ver la sesión activa debajo de cada monto:
   * `null` = sin filtro (ADMIN, MANAGER o sin sesión: se ven todas) y `[]` = el
   * personal de caja no ve ninguna, que es el valor de fábrica.
   *
   * Las activa el admin en Configuración → Cajero y son de la empresa: el cajero
   * que entra desde otro equipo las recibe al iniciar sesión.
   */
  readonly allowedConversionCodes = computed<string[] | null>(() => {
    // La sesión y la preferencia se leen siempre (aunque el rol no aplique): un
    // `computed` que sale antes de leer una señal no la registra como dependencia
    // y se queda con el valor de la primera vez —por ejemplo, sin sesión, cuando
    // el servicio se construye al abrir la aplicación—.
    const currencies = this.preferences.conversionCurrencies();
    sessionChanges();
    if (!storedIsCashier()) return null;
    return currencies ?? [];
  });

  /** Tasas disponibles: 2 (BCV) o 3 (con la personalizada). */
  readonly rates = computed(() => this._snapshot()?.rates ?? []);
  readonly custom = computed<CustomRate | null>(() => this._snapshot()?.custom ?? null);
  readonly hasCustom = computed(() => this.custom() !== null);
  readonly bcv = computed(() => this._snapshot()?.bcv ?? null);
  /**
   * Tasa USDT/VES de referencia (Binance P2P), solo para mostrar.
   * No se usa en ninguna conversión del sistema.
   */
  readonly reference = computed<ReferenceRate | null>(
    () => this._snapshot()?.reference ?? null,
  );
  /** `true` cuando la referencia viene de la última consulta válida. */
  readonly referenceStale = computed(() => this.reference()?.stale ?? false);
  readonly activeKey = computed<RateKey | null>(
    () => this._snapshot()?.activeKey ?? null,
  );
  /** `true` cuando el BCV no respondió y se muestra la última tasa conocida. */
  readonly stale = computed(() => this._snapshot()?.bcv.stale ?? false);
  readonly ready = computed(() => this._snapshot() !== null);

  /** Monedas configuradas con su tasa en bolívares. */
  readonly currencies = computed(() => this._snapshot()?.currencies ?? []);
  /** Monedas que se pueden cobrar/pagar (las habilitadas en Configuración). */
  readonly enabledCurrencies = computed(() =>
    this.currencies().filter((item) => item.enabled),
  );
  /** Moneda base con la que se muestran los montos (USD por defecto). */
  readonly baseCurrency = computed<BaseCurrencyInfo>(
    () => this._snapshot()?.baseCurrency ?? DEFAULT_BASE_CURRENCY,
  );
  /** Código de la moneda base (el que pinta `format.money()`). */
  readonly baseCode = computed(() => this.baseCurrency().code);
  /** `true` cuando los montos se muestran en una moneda distinta del dólar. */
  readonly convertsBase = computed(() => this.baseCode() !== BASE_CURRENCY_CODE);
  /** Bolívares por 1 USD con la tasa activa del sistema (personalizada si existe). */
  readonly bsPerUsd = computed(() => {
    const base = this.currencies().find((item) => item.isBase);
    return base?.bsPerUsd ?? this.bcv()?.current.usd ?? null;
  });

  /**
   * Carga (o recarga) las tasas. `force` pide al backend ignorar su caché y
   * volver a consultar el BCV; además, en multi-empresa, se usa tras iniciar
   * sesión o cambiar de empresa para traer las tasas/ monedas de esa empresa.
   */
  load(force = false): void {
    if (this._loading() && !force) return;

    // Identificador de petición: descarta respuestas obsoletas si el usuario
    // cambia de empresa antes de que llegue la anterior.
    const requestId = ++this.requestId;
    this._loading.set(true);

    this.http
      .get<RatesSnapshot>(`${this.baseUrl}${force ? '?refresh=true' : ''}`)
      .subscribe({
        next: (snapshot) => {
          if (requestId !== this.requestId) return;
          this._snapshot.set(snapshot);
          this.applyDisplayBase(snapshot);
          this._error.set(null);
          this._loading.set(false);
        },
        error: (error: Error) => {
          if (requestId !== this.requestId) return;
          this._error.set(error.message ?? 'No se pudieron cargar las tasas');
          this._loading.set(false);
        },
      });
  }

  /** Carga las tasas solo una vez (al montar el layout). */
  ensureLoaded(): void {
    if (!this.ready() && !this._loading()) this.load();
  }

  /**
   * Sincroniza el formateo global de montos (`format.money()`) con la moneda que
   * **este** usuario debe ver: la base de la empresa o la que el cajero eligió en
   * Configuración → Cajero. Los montos siguen guardándose en dólares.
   */
  private applyDisplayBase(snapshot: RatesSnapshot): void {
    const base = snapshot.baseCurrency;
    // Compatibilidad: un snapshot sin moneda base deja los montos en dólares.
    if (!base) {
      setDisplayCurrency(null);
      return;
    }
    setDisplayCurrency(this.displayFor(snapshot, base));
  }

  /**
   * Vuelve a aplicar la moneda de visualización con las tasas en curso.
   *
   * Lo llama Configuración → Cajero al guardar la moneda de los precios: la
   * preferencia se aplica sin recargar las tasas, así que sin esto el formateo
   * seguiría con la moneda anterior hasta la próxima carga.
   */
  applyDisplayPreference(): void {
    const snapshot = this._snapshot();
    if (snapshot) this.applyDisplayBase(snapshot);
  }

  /**
   * Moneda con la que ESTE usuario ve los precios del sistema.
   *
   * ADMIN y MANAGER ven siempre el precio **con el que se registró** cada
   * artículo (la moneda base de la empresa) y su conversión: la preferencia del
   * cajero no aplica a esos roles. El resto —el cajero y cualquier rol nuevo con
   * acceso al punto de venta— ve los precios en la moneda que la empresa tiene
   * configurada en Configuración → Cajero y, sin elección o sin tasa configurada,
   * en la moneda base del sistema.
   */
  private displayFor(
    snapshot: RatesSnapshot,
    base: BaseCurrencyInfo,
  ): DisplayCurrency {
    const companyBase: DisplayCurrency = {
      code: base.code,
      label: base.label,
      symbol: base.symbol,
      decimals: base.decimals ?? 2,
      bsPerUnit: base.bsPerUnit,
      bsPerUsd: base.bsPerUsd,
    };
    if (storedCanManage()) return companyBase;

    const code = this.preferences.priceCurrency();
    if (!code || code === companyBase.code) return companyBase;

    const option = snapshot.currencies.find((item) => item.code === code);
    // Sin tasa no hay conversión posible: se ven en la moneda base (Configuración
    // avisa de que falta la tasa de esa moneda).
    if (!option?.bsPerUnit) return companyBase;

    const meta = currencyMeta(option.code);
    return {
      code: option.code,
      label: option.label || meta.label,
      symbol: option.symbol || meta.symbol,
      decimals: meta.decimals,
      // La conversión usa el puente (bolívares por USD) de la moneda base.
      bsPerUnit: option.bsPerUnit,
      bsPerUsd: companyBase.bsPerUsd,
    };
  }

  /** Guarda la tasa personalizada; con `null` la elimina. */
  setCustomRate(usd: number | null, onDone?: (custom: CustomRate | null) => void): void {
    const request =
      usd === null
        ? this.http.delete<CustomRate | null>(`${this.baseUrl}/custom`)
        : this.http.put<CustomRate | null>(`${this.baseUrl}/custom`, { usd });

    request.subscribe({
      next: (custom) => {
        this.load(true);
        onDone?.(custom);
      },
    });
  }

  /** Muestra u oculta los montos "al cambio" en todo el sistema. */
  setConversions(show: boolean): void {
    this._conversions.set(show);
    try {
      localStorage.setItem(CONVERSIONS_KEY, show ? '1' : '0');
    } catch {
      /* almacenamiento no disponible */
    }
  }

  toggleConversions(): void {
    this.setConversions(!this._conversions());
  }

  /** Tasa con `key` (o la activa si se omite). */
  rateOf(key?: RateKey): number | null {
    const rates = this.rates();
    if (rates.length === 0) return null;
    const found = key ? rates.find((item) => item.key === key) : undefined;
    if (found) return found.rate;
    return rates.find((item) => item.key === this.activeKey())?.rate ?? rates[0].rate;
  }

  /**
   * Convierte un monto (en moneda base, USD) a bolívares con cada tasa activa.
   * Devuelve `[]` mientras las tasas no estén cargadas.
   *
   * La tasa personalizada no se lista: solo define el precio de vitrina de los
   * productos y no es una tasa de cobro ni una conversión que el operador deba
   * comparar debajo de cada monto. Las tasas oficiales (BCV dólar/euro) siguen
   * visibles.
   */
  conversions(amount: number | null | undefined): RateConversion[] {
    const value = Number(amount ?? 0);
    return this.rates()
      .filter((option) => option.key !== 'CUSTOM_USD')
      .map((option) => ({
        key: option.key,
        label: RATE_META[option.key]?.shortLabel ?? option.key,
        rate: option.rate,
        amount: value * option.rate,
        text: bs(value * option.rate),
        inBs: true,
      }));
  }

  /**
   * Convierte un monto (en moneda base contable, USD) a las demás monedas
   * configuradas: es la lista que se muestra debajo del monto cuando la moneda
   * base elegida no es el dólar.
   *
   * Cada línea va rotulada con la moneda **y el origen de su tasa**
   * (`USD · BCV`, `EUR · BCV`, `COP · manual`, `USD · personalizada`): con solo el
   * código, el dólar del BCV y el del local se ven iguales, y en un listado no hay
   * forma de saber con qué tasa se convirtió el monto.
   */
  currencyConversions(
    amount: number | null | undefined,
    bridgeKey?: RateKey | null,
  ): RateConversion[] {
    const usd = Number(amount ?? 0);
    const bsPerUsd = bridgeKey ? this.bsPerUsdWith(bridgeKey) : this.bsPerUsd();
    const base = this.baseCode();
    if (!bsPerUsd) return [];

    return this.currencies()
      .filter((item) => item.enabled && item.code !== base && !!item.bsPerUnit)
      // Con un puente oficial (BCV) el dolar de vitrina no se repite: la linea
      // oficial ya viene en `conversionLines` y este equivalente saldria con la
      // tasa personalizada.
      .filter(
        (item) =>
          !(bridgeKey && item.code === BASE_CURRENCY_CODE && item.source === 'CUSTOM'),
      )
      .map((item) => {
        const bsPerUnit = item.bsPerUnit as number;
        const value = round2((usd * bsPerUsd) / bsPerUnit);
        // La tasa personalizada no se rotula: es el precio de vitrina, no una
        // tasa de cobro. La moneda se muestra sola (`USD`) y el monto sigue
        // siendo el equivalente de vitrina.
        const source =
          item.source === 'CUSTOM' ? '' : rateSourceLabel(item.source);
        return {
          key: item.code,
          code: item.code,
          label: source ? `${item.code} · ${source}` : item.code,
          rate: bsPerUnit,
          amount: value,
          text: moneyIn(value, item.code),
        };
      });
  }

  /**
   * Conversiones completas del monto cuando la moneda base mostrada no es el
   * dólar: **cada tasa del sistema** (el dólar del BCV, el euro del BCV y la
   * personalizada del local) con el equivalente **en la moneda de esa tasa**, más
   * las demás monedas aceptadas cuya tasa no venga ya de una de ellas (por ejemplo
   * el peso con tasa manual), cada una en su propia moneda.
   *
   * La moneda base ya está en bolívares, así que repetir bolívares abajo no
   * aportaba nada (era el mismo monto otra vez): la línea de cada tasa es el monto
   * **vuelto a divisa** con esa tasa. Un margen de `Bs 9.054,20` son `USD · BCV
   * $ 10,33` al precio oficial del dólar y `USD · personalizada $ 10,00` a la tasa
   * del local: la comparación que el local necesita para decidir a cuál cobrar.
   *
   * Sin esto, con la moneda base en bolívares el listado perdía las tasas: solo
   * aparecían las monedas (`USD`, `EUR`) y no se veía el dólar del BCV.
   */
  conversionLines(
    amount: number | null | undefined,
    bridgeKey?: RateKey | null,
  ): RateConversion[] {
    const usd = Number(amount ?? 0);
    const bsPerUsd = bridgeKey ? this.bsPerUsdWith(bridgeKey) : this.bsPerUsd();
    const options = this.rates().filter((option) => option.key !== 'CUSTOM_USD');
    // Sin la tasa puente ni tasas del sistema no hay nada que rotular: quedan las
    // monedas configuradas (`currencyConversions`).
    if (!bsPerUsd || options.length === 0) {
      return this.currencyConversions(amount, bridgeKey);
    }

    // Bolívares que representa el monto (misma cuenta que `format.money()`): al
    // dividirlos por la tasa de cada línea queda el equivalente en su moneda.
    const bsAmount = usd * bsPerUsd;
    const byRate: RateConversion[] = options.map((option) => {
      const value = round2(bsAmount / option.rate);
      return {
        key: option.key,
        code: option.currency,
        label: `${option.currency} · ${rateSourceLabel(option.source)}`,
        rate: option.rate,
        amount: value,
        text: moneyIn(value, option.currency),
      };
    });
    // Una moneda se omite cuando su tasa ya es una de las listadas arriba (el dólar
    // del BCV, el euro del BCV, el dólar personalizado): da la misma conversión.
    const covered = new Set(byRate.map((item) => item.rate));
    return [
      ...byRate,
      ...this.currencyConversions(amount, bridgeKey).filter((item) => !covered.has(item.rate)),
    ];
  }

  /**
   * Repinta una conversión con un monto **en bolívares**: el que escribió el
   * operador cuando el registro guarda (`priceEntered`, `unitPriceEntered`, …) con
   * su tasa. Conserva la moneda de la línea: con la base en dólares la conversión
   * va en bolívares y con otra base va en la divisa de la tasa.
   */
  conversionWithBs(item: RateConversion, bsAmount: number): RateConversion {
    if (item.inBs) return { ...item, amount: bsAmount, text: bs(bsAmount) };
    const value = round2(bsAmount / item.rate);
    return { ...item, amount: value, text: moneyIn(value, item.code) };
  }

  /** Equivalente en bolívares con la tasa indicada (la activa por defecto). */
  toBs(amount: number | null | undefined, key?: RateKey): number | null {
    const rate = this.rateOf(key);
    if (rate === null) return null;
    return Number(amount ?? 0) * rate;
  }

  // ===========================================================================
  //  COBRO
  // ===========================================================================

  /**
   * Monto **tal como se está leyendo en pantalla**.
   *
   * Los montos del sistema viven en dólares, pero la empresa elige con qué moneda
   * mostrarlos (Configuración → Tasas; el admin puede fijar otra para el cajero).
   * Ese número —el que el operador lee en el pedido— es el precio que se cobra.
   */
  displayAmount(amount: number | null | undefined): number {
    // Se redondea PRIMERO el monto en moneda base: el cajero lee 2 decimales en
    // pantalla y la conversion tiene que partir de ese mismo numero. Sin esto un
    // total guardado de USD 9,3494 se veia como USD 9,35 pero al pasarlo a Bs con
    // la tasa BCV daba Bs 8.245,00 en vez de los Bs 8.245,48 que resultan de los
    // 9,35 que el cajero esta leyendo (la diferencia era solo el redondeo oculto).
    const value = round2(Number(amount ?? 0));
    const code = displayBaseCode();
    if (code === BASE_CURRENCY_CODE) return value;
    return this.fromBase(value, code) ?? value;
  }

  /**
   * Monto a cobrar en `currency` por un monto de venta ya expresado en USD (por
   * ejemplo el total de un pedido guardado): lo convierte directamente a la tasa
   * oficial del BCV.
   */
  chargeAmount(
    amount: number | null | undefined,
    currency?: string | null,
  ): number {
    const value = round2(Number(amount ?? 0));
    const target =
      String(currency ?? '').trim().toUpperCase() || BASE_CURRENCY_CODE;
    if (target === BASE_CURRENCY_CODE) return value;
    return this.fromBase(value, target, CHARGE_RATE_KEY) ?? value;
  }

  /**
   * Monto a cobrar por un precio del catalogo (USD base): primero se lleva al
   * precio de vitrina en bolívares con la tasa personalizada y luego se valora a
   * la tasa oficial del BCV.
   *
   * Ejemplo: $ 10 con personalizada 970 y BCV 881,87 -> Bs 9.700 de vitrina ->
   * $ 10,99 de venta. Es el mismo cálculo que aplica el backend al crear el
   * pedido.
   */
  saleChargeAmount(
    amount: number | null | undefined,
    currency?: string | null,
  ): number {
    const shown = this.displayAmount(amount);
    const display = displayBaseCode();
    const target =
      String(currency ?? '').trim().toUpperCase() || BASE_CURRENCY_CODE;
    if (target === display) return shown;

    const base = this.toBase(shown, display, CHARGE_RATE_KEY);
    if (base === null) return shown;
    if (target === BASE_CURRENCY_CODE) return base;
    return this.fromBase(base, target, CHARGE_RATE_KEY) ?? shown;
  }

  /**
   * Clave de tasa que debe viajar con un cobro. Es siempre `BCV_USD`: el
   * backend ignora cualquier otra y valora el pago a la tasa oficial.
   */
  chargeKeyFor(_currency?: string | null): RateKey {
    return CHARGE_RATE_KEY;
  }

  // ===========================================================================
  //  CONVERSIONES QUE VE EL CAJERO
  // ===========================================================================

  /**
   * Moneda de una conversión: la de la línea (`USD · BCV`) o el bolívar cuando la
   * línea ya viene en bolívares (las tasas del monto con la base en dólares).
   */
  conversionCurrency(item: RateConversion): string | null {
    if (item.code) return String(item.code).trim().toUpperCase();
    return item.inBs ? LOCAL_CURRENCY_CODE : null;
  }

  /**
   * Conversiones que puede ver esta sesión.
   *
   * El personal de caja solo ve las monedas que el admin activó en
   * Configuración → Cajero —ninguna por defecto: los precios, en su moneda, y
   * nada más—; ADMIN y MANAGER (y las pantallas sin sesión) siguen viendo todas,
   * igual que hasta ahora.
   */
  visibleConversions(items: readonly RateConversion[]): RateConversion[] {
    return items.filter((item) => this.showsConversion(this.conversionCurrency(item)));
  }

  /**
   * `true` cuando esta sesión puede ver el monto convertido a esa moneda: quien
   * administra el local (y las pantallas sin sesión) ven todas; el personal de caja
   * solo las que activó el admin en Configuración → Cajero.
   */
  showsConversion(code: string | null | undefined): boolean {
    const allowed = this.allowedConversionCodes();
    if (allowed === null) return true;
    const normalized = String(code ?? '').trim().toUpperCase();
    return normalized !== '' && allowed.includes(normalized);
  }

  /**
   * `true` cuando la sesión es del **personal de caja** y la empresa tiene activado
   * el precio en dólares del BCV (Configuración → Cajero). Es una línea aparte de
   * las conversiones: se suma a las que el cajero ya ve.
   *
   * ADMIN y MANAGER no lo ven —su vista no cambia con las preferencias del cajero—
   * y sin sesión tampoco se pinta.
   */
  readonly showBcvPrice = computed(() => {
    // El interruptor se lee antes del rol para que quede registrado como
    // dependencia siempre (ver `allowedConversionCodes`), y el rol se recalcula
    // cuando entra o sale una sesión en este mismo equipo.
    const enabled = this.preferences.showBcvPrice();
    sessionChanges();
    return storedIsCashier() && enabled;
  });

  /** Tasa oficial del BCV en bolívares por dólar (`null` si aún no está). */
  private readonly bcvUsdRate = computed(() => this.bcv()?.current.usd ?? null);

  /**
   * **Precio en dólares del BCV**: la línea que el admin activa en Configuración →
   * Cajero y que se suma a las conversiones de cada monto.
   *
   * La dirección depende de la moneda con la que se ven los precios (`code`, por
   * defecto la de la pantalla):
   *
   *   - Precios en **bolívares**: el monto ya dice cuántos bolívares son, así que
   *     la línea responde la otra pregunta del mostrador —**cuántos dólares
   *     oficiales son esos bolívares**— y va rotulada `USD · BCV`
   *     (Bs 8.767,98 → `USD · BCV $ 10,00`).
   *   - Precios en **dólares** (o en cualquier otra divisa): la línea es la vuelta,
   *     **cuántos bolívares** valen esas divisas a la tasa oficial del BCV, y va
   *     rotulada `VES · BCV` ($ 10,00 → `VES · BCV Bs 8.767,98`).
   *
   * Va rotulada con la tasa para no confundirla con el dólar de la tasa
   * personalizada del local.
   *
   * `bsAmount` son los bolívares tal como los escribió el operador cuando el
   * registro los guarda (`priceEntered`): con eso la línea respeta lo cargado y no
   * el redondeo a centavos del equivalente en dólares. Sin él se usan los
   * bolívares que salen de la tasa activa del sistema.
   *
   * Devuelve `null` cuando falta la tasa del BCV o no hay monto que convertir.
   */
  bcvUsdConversion(
    amount: number | null | undefined,
    bsAmount?: number | null,
    code: string = displayBaseCode(),
  ): RateConversion | null {
    const rate = this.bcvUsdRate();
    if (!rate) return null;

    const usd = Number(amount ?? 0);
    const shown =
      String(code ?? '')
        .trim()
        .toUpperCase() || BASE_CURRENCY_CODE;

    // Con los precios en una divisa la línea son los bolívares de la tasa oficial:
    // los dólares del monto multiplicados por la tasa del BCV. Los bolívares que
    // escribió el operador son de otra tasa (la del local), así que aquí no aplican.
    if (shown !== LOCAL_CURRENCY_CODE) {
      if (!usd) return null;
      const value = round2(usd * rate);
      return {
        key: BCV_USD_RATE_KEY,
        code: LOCAL_CURRENCY_CODE,
        label: `${LOCAL_CURRENCY_CODE} · ${rateSourceLabel('BCV')}`,
        rate,
        amount: value,
        text: moneyIn(value, LOCAL_CURRENCY_CODE),
      };
    }

    const entered = Number(bsAmount ?? NaN);
    // Con los precios en bolívares el monto guardado ya está valorado a la tasa
    // del BCV: se usan esos mismos bolívares. `bsPerUsd()` incluye la tasa
    // personalizada del local y aquí daría un dólar oficial más alto que el
    // cobrado (p. ej. $ 17,57 -> $ 19,29 con personalizada 970 y BCV 883,45).
    const bsTotal = Number.isFinite(entered) ? entered : usd * rate;
    if (!bsTotal) return null;

    const value = round2(bsTotal / rate);
    return {
      key: BCV_USD_RATE_KEY,
      code: BASE_CURRENCY_CODE,
      label: `${BASE_CURRENCY_CODE} · ${rateSourceLabel('BCV')}`,
      rate,
      amount: value,
      text: moneyIn(value, BASE_CURRENCY_CODE),
    };
  }

  // ===========================================================================
  //  MONEDAS DE PAGO
  // ===========================================================================

  /** Configuración y tasa de una moneda (o `undefined` si no está registrada). */
  currencyOf(code?: string | null): CurrencyRateOption | undefined {
    const normalized =
      String(code ?? '').trim().toUpperCase() || BASE_CURRENCY_CODE;
    return this.currencies().find((item) => item.code === normalized);
  }

  /** Etiqueta legible de una moneda ("Bolívares (VES)"). */
  currencyLabel(code?: string | null): string {
    const found = this.currencyOf(code);
    if (found) return `${found.label} (${found.code})`;
    const meta = currencyMeta(code);
    return `${meta.label} (${meta.code})`;
  }

  /** Bolívares por 1 unidad de `code` (1 para el bolívar; null si falta tasa). */
  bsPerUnit(code?: string | null): number | null {
    const normalized =
      String(code ?? '').trim().toUpperCase() || BASE_CURRENCY_CODE;
    if (normalized === BASE_CURRENCY_CODE) return this.bsPerUsd();
    if (normalized === LOCAL_CURRENCY_CODE) return 1;
    return this.currencyOf(normalized)?.bsPerUnit ?? null;
  }

  /**
   * Bolívares por 1 USD con la tasa **elegida** para un monto (`key`).
   *
   * El local decide con cuál de las tasas del sistema se convierte cada monto del
   * catálogo (precio, costo, costo unitario): la elegida reemplaza al puente por
   * defecto (la personalizada del dólar o, si no existe, el BCV dólar). Cuando esa
   * tasa ya no está disponible —por ejemplo, se eliminó la personalizada— se cae
   * en la activa, igual que el backend.
   */
  bsPerUsdWith(key?: RateKey | null): number | null {
    if (!key) return this.bsPerUsd();
    return this.rateOf(key) ?? this.bsPerUsd();
  }

  /**
   * Convierte un monto expresado en `code` a la moneda base (USD).
   * Con `key` la conversión usa esa tasa; sin ella, la activa del sistema.
   * Devuelve `null` cuando falta la tasa necesaria.
   */
  toBase(
    amount: number | null | undefined,
    code?: string | null,
    key?: RateKey | null,
  ): number | null {
    const value = Number(amount ?? 0);
    const normalized =
      String(code ?? '').trim().toUpperCase() || BASE_CURRENCY_CODE;
    if (normalized === BASE_CURRENCY_CODE) return round2(value);

    const bsPerUsd = this.bsPerUsdWith(key);
    if (!bsPerUsd) return null;
    const bsPerUnit = this.bsPerUnit(normalized);
    if (!bsPerUnit) return null;

    return round2((value * bsPerUnit) / bsPerUsd);
  }

  /** Convierte un monto de la moneda base (USD) a `code` con la tasa elegida. */
  fromBase(
    amount: number | null | undefined,
    code?: string | null,
    key?: RateKey | null,
  ): number | null {
    const value = Number(amount ?? 0);
    const normalized =
      String(code ?? '').trim().toUpperCase() || BASE_CURRENCY_CODE;
    if (normalized === BASE_CURRENCY_CODE) return round2(value);

    const bsPerUsd = this.bsPerUsdWith(key);
    const bsPerUnit = this.bsPerUnit(normalized);
    if (!bsPerUsd || !bsPerUnit) return null;

    return round2((value * bsPerUsd) / bsPerUnit);
  }

  /**
   * Texto del equivalente en moneda base de un monto en `code`
   * (ej. `= $ 12.34`). Devuelve `null` si no hay conversión que mostrar
   * (misma moneda o falta de tasa).
   */
  baseHint(
    amount: number | null | undefined,
    code?: string | null,
    key?: RateKey | null,
  ): string | null {
    const normalized = String(code ?? '').trim().toUpperCase();
    if (!normalized || normalized === BASE_CURRENCY_CODE) return null;
    const converted = this.toBase(amount, normalized, key);
    if (converted === null) return null;
    return `= ${money(converted)}`;
  }
}
