import test from 'node:test';
import assert from 'node:assert/strict';

/**
 * Integración del script de reconstrucción: borrar `envios` y reprocesar el
 * topic con un grupo nuevo deja la colección igual que antes.
 *
 * Requiere `npm run up`, RUTASUR_INTEGRACION=1 y el simulador detenido (el
 * topic quieto hace el conteo determinista).
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { cargarConfiguracion, crearLogger, conectarMongo } from '@rutasur/shared';

const execFileAsync = promisify(execFile);
const INTEGRACION = process.env.RUTASUR_INTEGRACION === '1';

test(
  'integración: scripts/rebuild-envios.js deja la colección en el mismo estado',
  { skip: !INTEGRACION ? 'Requiere RUTASUR_INTEGRACION=1, npm run up y el topic quieto' : false, timeout: 420000 },
  async () => {
    const config = cargarConfiguracion({ servicio: 'rebuild-test' });
    const logger = crearLogger({ servicio: 'rebuild-test', nivel: 'error' });
    const conexion = await conectarMongo({ uri: config.mongoUri, dbName: config.mongoDb, logger });
    const coleccion = conexion.db.collection('envios');

    // Snapshot antes de reconstruir (count + suma de secuencias aplicadas).
    const antes = await coleccion
      .aggregate([{ $group: { _id: null, docs: { $sum: 1 }, sectotal: { $sum: '$ultimaSecuencia' } } }])
      .toArray();

    await execFileAsync('node', ['scripts/rebuild-envios.js'], {
      cwd: process.cwd().includes('services/proyector')
        ? '../..'
        : process.cwd(),
      env: { ...process.env },
    });

    const despues = await coleccion
      .aggregate([{ $group: { _id: null, docs: { $sum: 1 }, sectotal: { $sum: '$ultimaSecuencia' } } }])
      .toArray();
    await conexion.cerrar();

    assert.ok(antes[0], 'la colección tenía datos antes de reconstruir');
    assert.deepEqual(despues[0], antes[0], 'misma cantidad de docs y mismas secuencias');
  },
);
