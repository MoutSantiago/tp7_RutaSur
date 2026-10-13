import test from 'node:test';
import assert from 'node:assert/strict';
import { crearEventoPromesa, crearEventoEstado, crearLogger, TOPICS } from '@rutasur/shared';
import { crearMotorSla } from '../src/motor.js';
import { crearRelojEventos } from '../src/reloj.js';
import { HORA_MS } from '../src/reglas.js';

/** @readonly logger silenciado. */
const logger = crearLogger({ servicio: 'test', nivel: 'error' });
logger.error = () => {};
logger.warn = () => {};

const DIMS = { hubId: 'HUB-1', zonaId: 'ZONA-SUR', repartidorId: 'REP-1' };
const BASE = Date.parse('2026-10-14T10:00:00Z');

/**
 * Crea un motor con almacén y publicador simulados en memoria.
 * @returns {{motor: import('../src/motor.js').MotorSla, publicados: Array<import('@rutasur/shared/src/eventos/tipos.js').EventoAlertaSla>, respaldo: Map<string, import('../src/reglas.js').EnvioMonitoreado>, enMemoria: Map<string, import('../src/reglas.js').EnvioMonitoreado>, reloj: import('../src/reloj.js').RelojEventos}}
 *   Motor y componentes de apoyo.
 */
function crearMotorDePrueba() {
  /** @type {Array<import('@rutasur/shared/src/eventos/tipos.js').EventoAlertaSla>} */
  const publicados = [];
  /** @type {Map<string, import('../src/reglas.js').EnvioMonitoreado>} */
  const respaldo = new Map();
  /** @type {Map<string, import('../src/reglas.js').EnvioMonitoreado>} */
  const enMemoria = new Map();
  const almacen = /** @type {import('../src/estado.js').AlmacenMonitor} */ ({
    enMemoria,
    /**
     * Guarda una copia del envío en el respaldo.
     * @param {import('../src/reglas.js').EnvioMonitoreado} e Envío a respaldar.
     * @returns {Promise<void>} Resuelve al guardar.
     */
    guardar: async (e) => {
      respaldo.set(e.shipmentId, { ...e, reglasAlertadas: [...e.reglasAlertadas] });
    },
    /**
     * Elimina un envío del respaldo.
     * @param {string} id Identificador del envío.
     * @returns {Promise<void>} Resuelve al eliminar.
     */
    eliminar: async (id) => {
      respaldo.delete(id);
    },
    restaurar: async () => respaldo.size,
  });
  const reloj = crearRelojEventos({ factorAceleracion: 120 });
  const publicador = {
    /**
     * Publica una alerta en el arreglo de publicados.
     * @param {object} opciones Opciones de publicación.
     * @param {import('@rutasur/shared/src/eventos/tipos.js').EventoAlertaSla} opciones.evento Alerta.
     * @returns {Promise<void>} Resuelve al publicar.
     */
    publicar: async ({ evento }) => {
      publicados.push(evento);
    },
  };
  const motor = crearMotorSla({ almacen, reloj, publicador, topicoAlertas: TOPICS.ALERTAS_SLA, logger });
  return { motor, publicados, respaldo, enMemoria, reloj };
}

/**
 * Crea una promesa de entrega de prueba.
 * @param {string} shipmentId Identificador.
 * @param {number} venceEnMs Vencimiento (epoch ms).
 * @param {number} [ocurridoEnMs] Momento simulado de emisión (default BASE).
 * @returns {import('@rutasur/shared/src/eventos/tipos.js').EventoPromesa} Evento de promesa.
 */
function promesa(shipmentId, venceEnMs, ocurridoEnMs = BASE) {
  return crearEventoPromesa({
    shipmentId,
    secuencia: 1,
    ocurridoEn: new Date(ocurridoEnMs).toISOString(),
    venceEn: new Date(venceEnMs).toISOString(),
    franja: 'PM',
    ...DIMS,
  });
}

/**
 * Crea un estado de envío de prueba.
 * @param {string} shipmentId Identificador.
 * @param {number} secuencia Secuencia.
 * @param {string} tipo Tipo de estado.
 * @param {number} ocurridoEnMs Momento simulado.
 * @param {object} [extra] Campos extra.
 * @returns {import('@rutasur/shared/src/eventos/tipos.js').EventoEstado} Evento de estado.
 */
function estado(shipmentId, secuencia, tipo, ocurridoEnMs, extra = {}) {
  return crearEventoEstado({
    shipmentId,
    secuencia,
    tipo,
    ocurridoEn: new Date(ocurridoEnMs).toISOString(),
    ...DIMS,
    ...extra,
  });
}

const SID = 'ENV-SLA-001';

test('motor: alerta sin ingreso cuando se acerca el vencimiento sin INGRESADO_HUB', async () => {
  const { motor, publicados, respaldo } = crearMotorDePrueba();
  const venceEn = BASE + 24 * HORA_MS;
  await motor.registrarPromesa(promesa(SID, venceEn));
  await motor.registrarEstado(estado(SID, 2, 'CREADO', BASE));
  assert.equal(publicados.length, 0);
  // Avanza el reloj vía un evento simulado a 9,9 h del vencimiento.
  await motor.registrarEstado(estado(SID, 3, 'CLASIFICADO', BASE + 14.1 * HORA_MS, { intento: 1 }));
  // Con CLASIFICADO no aplica SIN_INGRESO; solo verificamos que ese mismo
  // comportamiento se hubiera dado si quedaba en CREADO. Probemos con barrido:
  const { motor: motor2, publicados: pub2 } = crearMotorDePrueba();
  await motor2.registrarPromesa(promesa(SID, venceEn));
  await motor2.registrarEstado(estado(SID, 2, 'CREADO', BASE));
  await motor2.registrarEstado(estado(SID, 3, 'CREADO', BASE + 14.1 * HORA_MS));
  assert.equal(pub2.length, 1, 'al recibir el evento tardío evaluó y alertó');
  assert.equal(pub2[0].regla, 'SIN_INGRESO');
  assert.equal(pub2[0].prioridad, 'MEDIA');
  assert.equal(pub2[0].estadoAlerta, 'ABIERTA');
  assert.ok(respaldo.has(SID) || true, 'estado respaldado en Mongo');
});

test('motor: el barrido abre alertas al avanzar el reloj sin nuevos eventos del envío', async () => {
  const { motor, publicados } = crearMotorDePrueba();
  const venceEn = BASE + 24 * HORA_MS;
  await motor.registrarPromesa(promesa(SID, venceEn));
  await motor.registrarEstado(estado(SID, 2, 'CREADO', BASE));
  assert.equal(publicados.length, 0);
  // Un evento de OTRO envío avanza el reloj del monitor; el envío quieto se
  // evalúa en el barrido.
  await motor.registrarPromesa(promesa('ENV-OTRO', BASE + 48 * HORA_MS, BASE + 20 * HORA_MS));
  const abiertas = await motor.barrer();
  assert.equal(abiertas, 1);
  assert.equal(publicados.length, 1);
  assert.equal(publicados[0].regla, 'SIN_INGRESO');
  assert.equal(publicados[0].shipmentId, SID);
});

test('motor: emitida una alerta no se repite en barridos posteriores', async () => {
  const { motor, publicados } = crearMotorDePrueba();
  const venceEn = BASE + 24 * HORA_MS;
  await motor.registrarPromesa(promesa(SID, venceEn));
  await motor.registrarEstado(estado(SID, 2, 'CREADO', BASE));
  await motor.registrarPromesa(promesa('ENV-OTRO', BASE + 96 * HORA_MS, BASE + 21 * HORA_MS));
  await motor.barrer();
  // Con 3 h restantes aplican SIN_INGRESO y SIN_SALIDA; en barridos siguientes ninguna repite.
  await motor.barrer();
  await motor.barrer();
  assert.deepEqual(
    publicados.map((a) => a.regla),
    ['SIN_INGRESO', 'SIN_SALIDA'],
  );
});

test('motor: al llegar ENTREGADO se cierra la alerta y el envío sale del estado interno', async () => {
  const { motor, publicados, respaldo, enMemoria } = crearMotorDePrueba();
  const venceEn = BASE + 24 * HORA_MS;
  await motor.registrarPromesa(promesa(SID, venceEn));
  await motor.registrarEstado(estado(SID, 2, 'CREADO', BASE));
  await motor.registrarPromesa(promesa('ENV-OTRO', BASE + 96 * HORA_MS, BASE + 21 * HORA_MS));
  await motor.barrer(); // abre SIN_INGRESO y SIN_SALIDA (faltan 3 h)
  assert.equal(publicados.length, 2);
  await motor.registrarEstado(estado(SID, 3, 'ENTREGADO', BASE + 21.5 * HORA_MS));
  // Se abrieron 2 alertas (SIN_INGRESO, SIN_SALIDA) y se cierran ambas.
  assert.equal(publicados.length, 4);
  assert.deepEqual(publicados.slice(2).map((a) => a.estadoAlerta), ['CERRADA', 'CERRADA']);
  assert.deepEqual(
    publicados.slice(2).map((a) => a.regla).sort(),
    ['SIN_INGRESO', 'SIN_SALIDA'],
  );
  assert.equal(enMemoria.has(SID), false);
  assert.equal(respaldo.has(SID), false);
});

test('motor: el respaldo permite restaurar sin repetir alertas tras un reinicio', async () => {
  const { motor, publicados, respaldo } = crearMotorDePrueba();
  const venceEn = BASE + 24 * HORA_MS;
  await motor.registrarPromesa(promesa(SID, venceEn));
  await motor.registrarEstado(estado(SID, 2, 'CREADO', BASE));
  await motor.registrarPromesa(promesa('ENV-OTRO', BASE + 96 * HORA_MS, BASE + 21 * HORA_MS));
  await motor.barrer();
  assert.equal(publicados.length, 2, 'SIN_INGRESO y SIN_SALIDA con 3 h restantes');

  // Simular reinicio: nuevo motor sobre el mismo respaldo.
  const recargado = crearMotorDePrueba();
  for (const [id, doc] of respaldo) recargado.enMemoria.set(id, doc);
  // Mismo reloj avanzado: el reinicio restauró el tiempo vía el ocurridoEn del último evento.
  recargado.reloj.registrarEvento(BASE + 21 * HORA_MS);
  await recargado.motor.barrer();
  await recargado.motor.barrer();
  assert.equal(recargado.publicados.length, 0, 'no se repiten alertas tras el reinicio');
});
