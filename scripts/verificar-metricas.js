#!/usr/bin/env node
/**
 * Verificación manual de las métricas (CU4).
 *
 * Lee desde el inicio `envios.promesas` y `envios.estados` con un grupo nuevo,
 * recalcula los tres indicadores a mano y los compara contra
 * `metricas_diarias`. Pensado para correr después de una corrida con semilla
 * fija del simulador.
 *
 * Uso: node scripts/verificar-metricas.js
 */

import { randomUUID } from 'node:crypto';
import {
  TOPICS,
  cargarConfiguracion,
  crearLogger,
  conectarMongo,
  validarEvento,
} from '../packages/shared/src/index.js';
import {
  calcularIncrementos,
  claveParaEvento,
} from '../services/analitica/src/metricas.js';

/** Milisegundos de silencio que indican fin del histórico. */
const SILENCIO_FIN_MS = 4000;

/**
 * Punto de entrada del script de verificación.
 * @returns {Promise<void>} Resuelve al terminar la comparación.
 */
async function main() {
  const config = cargarConfiguracion({ servicio: 'verificar-metricas' });
  const logger = crearLogger({ servicio: 'verificar-metricas', nivel: 'info' });

  const conexion = await conectarMongo({ uri: config.mongoUri, dbName: config.mongoDb, logger });

  /** @type {Map<string, string>} shipmentId -> venceEn ISO. */
  const promesas = new Map();
  /** @type {Set<string>} eventId ya contados (los duplicados no incrementan dos veces). */
  const vistos = new Set();
  /** @type {Map<string, Record<string, number>>} clave JSON -> mapa ruta->total. */
  const esperado = new Map();
  let ultimoMensaje = Date.now();

  /**
   * Acumula los incrementos de un evento en el mapa esperado, ignorando duplicados por eventId.
   * @param {import('../packages/shared/src/eventos/tipos.js').EventoEstado} evento Evento de estado.
   * @returns {void}
   */
  function acumular(evento) {
    if (vistos.has(evento.eventId)) return;
    vistos.add(evento.eventId);
    const incs = calcularIncrementos(evento, promesas.get(evento.shipmentId) ?? null);
    // Los eventos llegan por Kafka solo por keys; si la promesa llega antes, bien;
    // si no, al menos se ignora el SLA como hace el servicio.
    if (Object.keys(incs).length === 0) return;
    const clave = claveParaEvento(evento);
    const claveStr = JSON.stringify(clave);
    const doc = esperado.get(claveStr) ?? {};
    for (const [ruta, delta] of Object.entries(incs)) {
      doc[ruta] = (doc[ruta] ?? 0) + delta;
    }
    esperado.set(claveStr, doc);
  }

  const { Kafka } = await import('kafkajs');
  const kafka = new Kafka({ clientId: 'verificar-metricas', brokers: config.kafkaBrokers });

  /**
   * Lee un topic desde el inicio con un grupo nuevo hasta agotar el histórico.
   * @param {string} topico Topic a leer.
   * @param {(valor: unknown) => void} alRecibir Función que procesa cada mensaje.
   * @returns {Promise<void>} Resuelve cuando no llegan mensajes por SILENCIO_FIN_MS.
   */
  async function leerTopicCompleto(topico, alRecibir) {
    const consumidor = kafka.consumer({ groupId: `verificador-${randomUUID()}` });
    await consumidor.connect();
    await consumidor.subscribe({ topic: topico, fromBeginning: true });
    ultimoMensaje = Date.now();
    await consumidor.run({
      autoCommit: false,
      eachMessage: async ({ topic: topicoMensaje, message }) => {
        ultimoMensaje = Date.now();
        const valor = JSON.parse(message.value.toString());
        const { valido } = validarEvento(topicoMensaje, valor);
        if (!valido) return;
        alRecibir(valor);
      },
    });
    while (Date.now() - ultimoMensaje < SILENCIO_FIN_MS) {
      await new Promise((resolver) => setTimeout(resolver, 500));
    }
    await consumidor.stop();
    await consumidor.disconnect();
  }

  // Pasada 1: todas las promesas, para conocer el vencimiento antes de evaluar SLA.
  logger.info('Leyendo envios.promesas desde el inicio...');
  await leerTopicCompleto(TOPICS.PROMESAS, (valor) => {
    const promesa = /** @type {import('../packages/shared/src/eventos/tipos.js').EventoPromesa} */ (valor);
    promesas.set(promesa.shipmentId, promesa.venceEn);
  });

  // Pasada 2: todos los estados, ya con las promesas completas.
  logger.info('Recalculando métricas desde el inicio de envios.estados...');
  await leerTopicCompleto(TOPICS.ESTADOS, (valor) => {
    acumular(/** @type {import('../packages/shared/src/eventos/tipos.js').EventoEstado} */ (valor));
  });

  // Comparar contra metricas_diarias, documento por documento.
  const coleccion = conexion.db.collection('metricas_diarias');
  let ok = 0;
  let conDiferencias = 0;
  for (const [claveStr, incsEsperados] of esperado) {
    const clave = JSON.parse(claveStr);
    const real = await coleccion.findOne(clave);
    for (const [ruta, totalEsperado] of Object.entries(incsEsperados)) {
      const realValor = ruta.split('.').reduce((d, k) => d?.[k], real) ?? 0;
      if (realValor !== totalEsperado) {
        conDiferencias += 1;
        logger.warn('Diferencia detectada', { clave, ruta, esperado: totalEsperado, real: realValor });
      } else ok += 1;
    }
  }
  const docsReales = await coleccion.estimatedDocumentCount();
  logger.info('Verificación finalizada', {
    clavesEvaluadas: esperado.size,
    coincidencias: ok,
    diferencias: conDiferencias,
    documentosEnMongo: docsReales,
  });
  await conexion.cerrar();
  process.exit(conDiferencias === 0 ? 0 : 1);
}

await main();
