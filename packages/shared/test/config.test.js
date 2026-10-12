import test from 'node:test';
import assert from 'node:assert/strict';
import { cargarConfiguracion, ErrorConfiguracion } from '../src/config.js';

test('config: con entorno vacío aplica los valores por defecto locales', () => {
  const config = cargarConfiguracion({ servicio: 'proyector', env: {} });
  assert.deepEqual(config.kafkaBrokers, ['localhost:9092']);
  assert.match(config.mongoUri, /^mongodb:\/\//);
  assert.equal(config.mongoDb, 'rutasur');
  assert.equal(config.logNivel, 'info');
});

test('config: parsea múltiples brokers y descarta entradas vacías', () => {
  const config = cargarConfiguracion({
    servicio: 'simulador',
    env: { KAFKA_BROKERS: 'kafka1:9092, kafka2:9092,' },
  });
  assert.deepEqual(config.kafkaBrokers, ['kafka1:9092', 'kafka2:9092']);
});

test('config: rechaza la URI de Mongo sin esquema mongodb', () => {
  assert.throws(
    () =>
      cargarConfiguracion({
        servicio: 'proyector',
        env: { MONGO_URI: 'localhost:27017' },
      }),
    (error) => {
      assert.ok(error instanceof ErrorConfiguracion);
      assert.ok(error.problemas.some((p) => p.includes('MONGO_URI')));
      return true;
    },
  );
});

test('config: rechaza un nivel de log desconocido y lista el problema', () => {
  assert.throws(
    () => cargarConfiguracion({ servicio: 'proyector', env: { LOG_NIVEL: 'verbosisimo' } }),
    (error) => {
      assert.ok(error instanceof ErrorConfiguracion);
      assert.ok(error.problemas.some((p) => p.includes('LOG_NIVEL')));
      return true;
    },
  );
});
