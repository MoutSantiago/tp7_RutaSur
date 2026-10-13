import test from 'node:test';
import assert from 'node:assert/strict';

/**
 * Integración del monitor de SLA contra MongoDB real: el respaldo del estado
 * interno permite reiniciar sin perder ni repetir alertas.
 *
 * Requiere `npm run up` y RUTASUR_INTEGRACION=1.
 */
import { randomUUID } from 'node:crypto';
import {
  crearEventoPromesa,
  crearEventoEstado,
  crearLogger,
  cargarConfiguracion,
  conectarMongo,
  TOPICS,
} from '@rutasur/shared';
import { crearMotorSla } from '../src/motor.js';
import { crearRelojEventos } from '../src/reloj.js';
import { crearAlmacenMonitor, asegurarIndicesMonitor } from '../src/estado.js';
import { HORA_MS } from '../src/reglas.js';

const INTEGRACION = process.env.RUTASUR_INTEGRACION === '1';
const BASE = Date.parse('2026-10-14T10:00:00Z');
const DIMS = { hubId: 'HUB-1', zonaId: 'ZONA-SUR', repartidorId: 'REP-1' };

/** @readonly logger silenciado. */
const logger = crearLogger({ servicio: 'test', nivel: 'error' });
logger.error = () => {};
logger.warn = () => {};

test(
  'integración: reiniciar el monitor no repite alertas gracias al respaldo en Mongo',
  { skip: !INTEGRACION ? 'Requiere RUTASUR_INTEGRACION=1 y npm run up' : false, timeout: 60000 },
  async () => {
    const config = cargarConfiguracion({ servicio: 'monitor-sla-test' });
    const conexion = await conectarMongo({ uri: config.mongoUri, dbName: config.mongoDb, logger });
    await asegurarIndicesMonitor(conexion.db);
    const coleccion = conexion.db.collection('monitor_sla_estado');
    const shipmentId = `ENV-${randomUUID().slice(0, 8).toUpperCase()}`;
    await coleccion.deleteOne({ shipmentId });

    const crearMotor = async () => {
      /** @type {Array<import('@rutasur/shared/src/eventos/tipos.js').EventoAlertaSla>} */
      const publicados = [];
      const almacen = crearAlmacenMonitor(conexion.db);
      await almacen.restaurar();
      const reloj = crearRelojEventos({});
      const publicador = {
        /**
         * Registra la alerta publicada.
         * @param {object} opciones Opciones.
         * @param {import('@rutasur/shared/src/eventos/tipos.js').EventoAlertaSla} opciones.evento Alerta.
         * @returns {Promise<void>} Resuelve al registrar.
         */
        publicar: async ({ evento }) => {
          publicados.push(evento);
        },
      };
      return { motor: crearMotorSla({ almacen, reloj, publicador, topicoAlertas: TOPICS.ALERTAS_SLA, logger }), publicados, reloj };
    };

    // Turno 1: crea el envío, avanza el reloj y abre la alerta; luego "cae".
    const t1 = await crearMotor();
    await t1.motor.registrarPromesa(
      crearEventoPromesa({
        shipmentId,
        secuencia: 1,
        ocurridoEn: new Date(BASE).toISOString(),
        venceEn: new Date(BASE + 24 * HORA_MS).toISOString(),
        franja: 'PM',
        ...DIMS,
      }),
    );
    await t1.motor.registrarEstado(
      crearEventoEstado({ shipmentId, secuencia: 2, tipo: 'CREADO', ocurridoEn: new Date(BASE).toISOString(), ...DIMS }),
    );
    await t1.reloj.registrarEvento(BASE + 21 * HORA_MS); // avanza el reloj simulado
    const abiertas1 = await t1.motor.barrer();
    assert.equal(abiertas1, 2, 'SIN_INGRESO + SIN_SALIDA a 3 h del vencimiento');

    // Turno 2: "reinicio" — nuevo motor sobre el mismo respaldo, mismo reloj.
    const t2 = await crearMotor();
    t2.reloj.registrarEvento(BASE + 21 * HORA_MS);
    const abiertas2 = await t2.motor.barrer();
    await t2.motor.barrer();
    assert.equal(abiertas2, 0, 'no repite alertas tras el reinicio');
    assert.equal(
      await coleccion.countDocuments({ shipmentId }),
      1,
      'restauró el envío abierto de este test',
    );

    // Turno 2: al entregar se cierran las 2 alertas abiertas (y no se pierden).
    await t2.motor.registrarEstado(
      crearEventoEstado({ shipmentId, secuencia: 3, tipo: 'ENTREGADO', ocurridoEn: new Date(BASE + 22 * HORA_MS).toISOString(), ...DIMS }),
    );
    const cerradas = t2.publicados.filter(
      (a) => a.estadoAlerta === 'CERRADA' && a.shipmentId === shipmentId,
    );
    assert.deepEqual(
      cerradas.map((a) => a.regla).sort(),
      ['SIN_INGRESO', 'SIN_SALIDA'],
    );
    assert.equal(await coleccion.countDocuments({ shipmentId }), 0, 'el respaldo quedó limpio');

    await coleccion.deleteOne({ shipmentId });
    await conexion.cerrar();
  },
);
