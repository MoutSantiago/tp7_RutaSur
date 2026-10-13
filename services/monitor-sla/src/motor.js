/**
 * Motor del monitor de SLA: orquesta estado interno, reloj de eventos,
 * evaluación por evento y barrido periódico, publicación y persistencia.
 * La evaluación de reglas vive en `reglas.js` (pura); acá está la orquestación.
 *
 * Eventos y barrido comparten el estado en memoria, así que todas las
 * operaciones pasan por una cadena serializada (evita evaluaciones
 * concurrentes del mismo envío que dupliquen alertas).
 */

import { crearEventoAlertaSla } from '@rutasur/shared';
import {
  evaluarEnvio,
  actualizarConEvento,
  ESTADOS_TERMINALES,
  PRIORIDAD_POR_REGLA,
} from './reglas.js';

/**
 * Motor de monitoreo de SLA.
 * @typedef {object} MotorSla
 * @property {(evento: import('@rutasur/shared/src/eventos/tipos.js').EventoPromesa) => Promise<void>} registrarPromesa Registra/actualiza el vencimiento de un envío.
 * @property {(evento: import('@rutasur/shared/src/eventos/tipos.js').EventoEstado) => Promise<void>} registrarEstado Actualiza el estado, evalúa reglas y emite alertas.
 * @property {() => Promise<number>} barrer Evalúa todos los envíos abiertos una vez.
 * @property {number} cantidadAbiertos Cantidad de envíos abiertos en memoria.
 */

/**
 * Crea el motor de SLA con sus dependencias inyectadas.
 * @param {object} opciones Opciones del motor.
 * @param {import('./estado.js').AlmacenMonitor} opciones.almacen Estado interno persistente.
 * @param {import('./reloj.js').RelojEventos} opciones.reloj Reloj simulado alimentado por eventos.
 * @param {{publicar: (opciones: {topico: string, evento: import('@rutasur/shared/src/eventos/tipos.js').EventoAlertaSla}) => Promise<void>}} opciones.publicador
 *   Productor de alertas.
 * @param {string} opciones.topicoAlertas Topic de destino de las alertas.
 * @param {import('@rutasur/shared').Logger} opciones.logger Logger estructurado.
 * @returns {MotorSla} Motor listo para operar.
 */
export function crearMotorSla({ almacen, reloj, publicador, topicoAlertas, logger }) {
  /**
   * Emite una alerta para un envío (abierta o cerrada).
   * @param {import('./reglas.js').EnvioMonitoreado} envio Envío asociado.
   * @param {string} regla Regla disparada.
   * @param {string} prioridad Prioridad de la alerta.
   * @param {string} estadoAlerta ABIERTA o CERRADA.
   * @param {number} ahoraMs Momento simulado de emisión.
   * @returns {Promise<void>} Resuelve cuando la alerta quedó publicada.
   */
  async function emitirAlerta(envio, regla, prioridad, estadoAlerta, ahoraMs) {
    const alerta = crearEventoAlertaSla({
      shipmentId: envio.shipmentId,
      secuencia: envio.ultimaSecuencia || 1,
      ocurridoEn: new Date(ahoraMs).toISOString(),
      hubId: envio.hubId,
      zonaId: envio.zonaId,
      repartidorId: envio.repartidorId,
      regla,
      prioridad,
      estadoAlerta,
      venceEn: new Date(/** @type {number} */ (envio.venceEnMs)).toISOString(),
    });
    await publicador.publicar({ topico: topicoAlertas, evento: alerta });
    logger.info('Alerta de SLA emitida', {
      shipmentId: envio.shipmentId,
      regla,
      prioridad,
      estadoAlerta,
    });
  }

  /**
   * Evalúa un envío sobre el momento simulado actual, publica las alertas
   * nuevas y persiste el estado actualizado.
   * @param {import('./reglas.js').EnvioMonitoreado} envio Envío a evaluar.
   * @returns {Promise<number>} Cantidad de alertas abiertas.
   */
  async function evaluarYPublicar(envio) {
    const ahoraMs = reloj.ahora();
    const alertas = evaluarEnvio(envio, ahoraMs);
    for (const alerta of alertas) {
      await emitirAlerta(envio, alerta.regla, alerta.prioridad, 'ABIERTA', ahoraMs);
      envio.reglasAlertadas.push(alerta.regla);
    }
    if (alertas.length > 0) await almacen.guardar(envio);
    return alertas.length;
  }

  /**
   * Registra o actualiza el vencimiento de un envío y evalúa las reglas.
   * @param {import('@rutasur/shared/src/eventos/tipos.js').EventoPromesa} evento Evento de promesa.
   * @returns {Promise<void>} Resuelve al terminar.
   */
  async function registrarPromesaImpl(evento) {
    reloj.registrarEvento(evento.ocurridoEn);
    const venceEnMs = Date.parse(evento.venceEn);
    const existente = almacen.enMemoria.get(evento.shipmentId);
    const envio =
      existente ??
      /** @type {import('./reglas.js').EnvioMonitoreado} */ ({
        shipmentId: evento.shipmentId,
        ultimoEstado: null,
        venceEnMs: null,
        ultimaSecuencia: evento.secuencia,
        ultimoFalloEnMs: null,
        entregado: false,
        reglasAlertadas: [],
        hubId: evento.hubId,
        zonaId: evento.zonaId,
        repartidorId: evento.repartidorId,
      });
    envio.venceEnMs = venceEnMs;
    almacen.enMemoria.set(evento.shipmentId, envio);
    await almacen.guardar(envio);
    await evaluarYPublicar(envio);
  }

  /**
   * Actualiza el estado interno con un evento de estado, evalúa las reglas y,
   * si el envío terminó, emite el cierre de sus alertas y lo da de baja.
   * @param {import('@rutasur/shared/src/eventos/tipos.js').EventoEstado} evento Evento de estado.
   * @returns {Promise<void>} Resuelve al terminar.
   */
  async function registrarEstadoImpl(evento) {
    reloj.registrarEvento(evento.ocurridoEn);
    let envio = almacen.enMemoria.get(evento.shipmentId);
    if (!envio) {
      // El estado llegó antes que la promesa: queda inerte hasta que llegue.
      envio = {
        shipmentId: evento.shipmentId,
        ultimoEstado: null,
        venceEnMs: null,
        ultimaSecuencia: 0,
        ultimoFalloEnMs: null,
        entregado: false,
        reglasAlertadas: [],
        hubId: evento.hubId,
        zonaId: evento.zonaId,
        repartidorId: evento.repartidorId,
      };
    }
    // Descarte por orden: solo se aplican secuencias nuevas de este envío.
    if (evento.secuencia > envio.ultimaSecuencia || envio.ultimoEstado === null) {
      envio = actualizarConEvento(envio, evento);
    }
    almacen.enMemoria.set(evento.shipmentId, envio);

    if (envio.entregado || ESTADOS_TERMINALES.includes(evento.tipo)) {
      const ahoraMs = reloj.ahora();
      const prioridades = /** @type {Record<string, string>} */ (PRIORIDAD_POR_REGLA);
      for (const regla of envio.reglasAlertadas) {
        await emitirAlerta(envio, regla, prioridades[regla], 'CERRADA', ahoraMs);
      }
      almacen.enMemoria.delete(evento.shipmentId);
      await almacen.eliminar(evento.shipmentId);
      logger.info('Envío cerrado en el monitor', {
        shipmentId: evento.shipmentId,
        alertasCerradas: envio.reglasAlertadas.length,
      });
      return;
    }

    await almacen.guardar(envio);
    await evaluarYPublicar(envio);
  }

  /**
   * Evalúa todos los envíos abiertos una vez (barrido periódico).
   * @returns {Promise<number>} Total de alertas abiertas en esta pasada.
   */
  async function barrerImpl() {
    const ahoraMs = reloj.ahora();
    if (ahoraMs === 0) return 0;
    let abiertas = 0;
    for (const envio of almacen.enMemoria.values()) {
      abiertas += await evaluarYPublicar(envio);
    }
    return abiertas;
  }

  // Todas las operaciones públicas se serializan: comparten el estado en
  // memoria y una evaluación concurrente del mismo envío duplicaría alertas.
  /** @type {Promise<unknown>} */
  let cadena = Promise.resolve();

  /**
   * Encola una operación del motor para ejecutarla en exclusión mutua.
   * @template T
   * @param {() => Promise<T>} operacion Operación a encolar.
   * @returns {Promise<T>} Resultado de la operación.
   */
  function serial(operacion) {
    const resultado = cadena.then(operacion);
    cadena = resultado.catch(() => {});
    return resultado;
  }

  return {
    get cantidadAbiertos() {
      return almacen.enMemoria.size;
    },
    registrarPromesa: (evento) => serial(() => registrarPromesaImpl(evento)),
    registrarEstado: (evento) => serial(() => registrarEstadoImpl(evento)),
    barrer: () => serial(barrerImpl),
  };
}
