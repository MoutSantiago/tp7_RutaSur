import test from 'node:test';
import assert from 'node:assert/strict';
import { crearProcesadorMensaje, RESULTADOS_PROCESAMIENTO } from '../src/kafka/consumidor.js';
import { crearLogger } from '../src/logger.js';
import { crearEventoEstado } from '../src/eventos/fabrica.js';
import { TOPICS } from '../src/constantes.js';

/**
 * Crea un logger con la salida silenciada para no ensuciar la consola de tests.
 * @returns {import('../src/logger.js').Logger} Logger que no imprime.
 */
function loggerSilencioso() {
  const logger = crearLogger({ servicio: 'test', nivel: 'error' });
  logger.error = () => {};
  logger.warn = () => {};
  return logger;
}

/**
 * Crea un procesador con mocks registradores para DLQ, handler e idempotencia.
 * @param {object} [opciones] Opciones opcionales.
 * @param {boolean} [opciones.duplicado] Si la idempotencia siempre reporta duplicado.
 * @param {import('../src/kafka/consumidor.js').HandlerEvento} [opciones.handler] Handler personalizado.
 * @returns {{procesador: import('../src/kafka/consumidor.js').ProcesadorMensaje, enviadosDlq: Array<{clave: string, valor: import('../src/eventos/tipos.js').MensajeDlq}>, manejados: Array<{evento: import('../src/eventos/tipos.js').EventoBase, contexto: import('../src/kafka/consumidor.js').ContextoMensaje}>}}
 *   Procesador y mocks de apoyo.
 */
function crearProcesadorConMocks({ duplicado = false, handler } = {}) {
  /** @type {Array<{clave: string, valor: import('../src/eventos/tipos.js').MensajeDlq}>} */
  const enviadosDlq = [];
  /** @type {Array<{evento: import('../src/eventos/tipos.js').EventoBase, contexto: import('../src/kafka/consumidor.js').ContextoMensaje}>} */
  const manejados = [];
  const procesador = crearProcesadorMensaje({
    consumidor: 'test-consumidor',
    logger: loggerSilencioso(),
    enviarADlq: async ({ clave, valor }) => {
      enviadosDlq.push({ clave, valor });
    },
    marcarSiNuevo: async () => !duplicado,
    handler: async (evento, contexto) => {
      if (handler) await handler(evento, contexto);
      manejados.push({ evento, contexto });
    },
  });
  return { procesador, enviadosDlq, manejados };
}

const BASE = { shipmentId: 'ENV-0001', secuencia: 1, hubId: 'HUB-1', zonaId: 'ZONA-1', repartidorId: 'REP-1' };
const CONTEXTO = { topico: TOPICS.ESTADOS, particion: 0, offset: '42' };

test('procesador: un evento válido llega al handler con su contexto', async () => {
  const evento = crearEventoEstado({ ...BASE, tipo: 'CREADO' });
  const { procesador, manejados, enviadosDlq } = crearProcesadorConMocks();

  const resultado = await procesador.procesar({
    ...CONTEXTO,
    valorCrudo: JSON.stringify(evento),
  });

  assert.equal(resultado, RESULTADOS_PROCESAMIENTO.PROCESADO);
  assert.equal(manejados.length, 1);
  assert.deepEqual(manejados[0].evento, evento);
  assert.deepEqual(manejados[0].contexto, {
    topico: TOPICS.ESTADOS,
    particion: 0,
    offset: '42',
  });
  assert.equal(enviadosDlq.length, 0);
});

test('DLQ: un JSON malformado va a la DLQ con clave "desconocido"', async () => {
  const { procesador, enviadosDlq, manejados } = crearProcesadorConMocks();

  const resultado = await procesador.procesar({
    ...CONTEXTO,
    valorCrudo: '{ esto no es json',
  });

  assert.equal(resultado, RESULTADOS_PROCESAMIENTO.DLQ);
  assert.equal(manejados.length, 0);
  assert.equal(enviadosDlq.length, 1);
  assert.equal(enviadosDlq[0].clave, 'desconocido');
  assert.match(enviadosDlq[0].valor.motivoError, /JSON inválido/);
  assert.equal(enviadosDlq[0].valor.consumidor, 'test-consumidor');
  assert.equal(enviadosDlq[0].valor.topicOrigen, TOPICS.ESTADOS);
  assert.equal(enviadosDlq[0].valor.particion, 0);
  assert.equal(enviadosDlq[0].valor.offset, '42');
});

test('DLQ: un evento inválido va a la DLQ con el motivo y su shipmentId', async () => {
  const invalido = { ...BASE, tipo: 'ESTADO_INEXISTENTE', eventId: 'evt-x', ocurridoEn: new Date().toISOString(), version: 1 };
  const { procesador, enviadosDlq, manejados } = crearProcesadorConMocks();

  const resultado = await procesador.procesar({
    ...CONTEXTO,
    valorCrudo: JSON.stringify(invalido),
  });

  assert.equal(resultado, RESULTADOS_PROCESAMIENTO.DLQ);
  assert.equal(manejados.length, 0);
  assert.equal(enviadosDlq.length, 1);
  assert.equal(enviadosDlq[0].clave, 'ENV-0001');
  assert.ok(enviadosDlq[0].valor.motivoError.length > 0);
  assert.deepEqual(enviadosDlq[0].valor.eventoOriginal, invalido);
});

test('DLQ: tras enviar un inválido a la DLQ el flujo continúa con mensajes válidos', async () => {
  const { procesador, manejados, enviadosDlq } = crearProcesadorConMocks();
  await procesador.procesar({ ...CONTEXTO, offset: '1', valorCrudo: '{"roto":true' });
  const eventoValido = crearEventoEstado({ ...BASE, tipo: 'ENTREGADO', secuencia: 2 });
  const resultado = await procesador.procesar({
    ...CONTEXTO,
    offset: '2',
    valorCrudo: JSON.stringify(eventoValido),
  });

  assert.equal(enviadosDlq.length, 1);
  assert.equal(resultado, RESULTADOS_PROCESAMIENTO.PROCESADO);
  assert.equal(manejados.length, 1);
});

test('idempotencia: un eventId ya procesado se descarta sin llamar al handler ni a la DLQ', async () => {
  const evento = crearEventoEstado({ ...BASE, tipo: 'CREADO' });
  const { procesador, manejados, enviadosDlq } = crearProcesadorConMocks({ duplicado: true });

  const resultado = await procesador.procesar({
    ...CONTEXTO,
    valorCrudo: JSON.stringify(evento),
  });

  assert.equal(resultado, RESULTADOS_PROCESAMIENTO.DUPLICADO);
  assert.equal(manejados.length, 0);
  assert.equal(enviadosDlq.length, 0);
});

test('procesador: un error del handler se propaga para reintentar el mensaje', async () => {
  const evento = crearEventoEstado({ ...BASE, tipo: 'EN_REPARTO' });
  const { procesador } = crearProcesadorConMocks({
    handler: async () => {
      throw new Error('mongo caído');
    },
  });

  await assert.rejects(
    procesador.procesar({ ...CONTEXTO, valorCrudo: JSON.stringify(evento) }),
    /mongo caído/,
  );
});
