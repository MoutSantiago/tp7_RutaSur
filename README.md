# RutaSur

Plataforma de seguimiento de envíos en tiempo real para un operador de última milla,
construida sobre una arquitectura orientada a eventos. Trabajo práctico de
Programación Avanzada (FCyT, 2026).

La especificación completa está en [`docs/spec.md`](docs/spec.md).

## Stack

- **Node.js >= 20** (ESM, JavaScript con JSDoc y `checkJs`).
- **Apache Kafka** (KRaft) como único punto de contacto entre servicios.
- **MongoDB** (replica set de un nodo) para vistas derivadas de lectura.
- **Next.js** para la interfaz (solo lee de MongoDB).

## Estructura del monorepo

```
packages/shared         Utilidades compartidas (ver abajo)
services/simulador      Genera envíos, promesas y cambios de estado
services/proyector      Mantiene las vistas de lectura en MongoDB
services/notificaciones Registra avisos al destinatario ante fallos y alertas
services/reprogramacion Decide el próximo intento tras una entrega fallida
services/monitor-sla    Detecta envíos en riesgo y emite alertas de SLA
services/analitica      Actualiza los agregados de metricas_diarias
apps/web                Interfaz Next.js (placeholder por ahora)
docs/                   Especificación y registro de decisiones
```

## Requisitos

- Node.js 20 (ver `.nvmrc`; con `nvm`: `nvm use`).
- Docker con Docker Compose v2.

## Puesta en marcha

```bash
npm install
npm run up      # levanta Kafka (KRaft) + MongoDB (replica set) y crea los topics
npm run check   # lint + typecheck + tests
npm run down    # detiene el entorno y borra los volúmenes (datos incluidos)
```

## Infraestructura local (`docker-compose.yml`)

- **Kafka** en modo KRaft (un solo broker, sin ZooKeeper):
  - `localhost:9092` para conexiones de servicios corriendo fuera de Docker.
  - `kafka:29092` para conexiones entre contenedores.
- **MongoDB 7** como replica set de un nodo (`rs0`), necesario para los change
  streams. El servicio `mongodb-init-rs` ejecuta `rs.initiate` automáticamente.
  Conexión: `mongodb://localhost:27017/?replicaSet=rs0&directConnection=true`.
- **`kafka-init-topics`** crea los 6 topics del catálogo al arrancar
  (idempotente con `--if-not-exists`):

  | Topic | Particiones | Retención / política |
  | :--- | :--- | :--- |
  | `envios.estados` | 3 | 30 días |
  | `envios.promesas` | 3 | compactado |
  | `envios.reprogramaciones` | 3 | 30 días |
  | `alertas.sla` | 3 | 7 días |
  | `notificaciones.enviadas` | 3 | 7 días |
  | `envios.estados.dlq` | 3 | 30 días |

  La clave de partición es siempre `shipmentId` (la aplican los productores al
  publicar).

Los datos persisten en los volúmenes `kafka-data` y `mongo-data` (`npm run down`
los elimina).

### Scripts utilitarios

| Script             | Qué hace                                                        |
| :----------------- | :-------------------------------------------------------------- |
| `scripts/topics.sh` | Lista los topics con particiones, retención y política          |
| `scripts/lag.sh`    | Muestra el lag de cada grupo de consumidores                    |

Ambos aceptan un argumento opcional para filtrar por topic o por grupo.

## Scripts raíz

| Comando             | Qué hace                                        |
| :------------------ | :---------------------------------------------- |
| `npm run up`        | Levanta el entorno Docker y crea los topics     |
| `npm run down`      | Detiene el entorno y borra volúmenes            |
| `npm run lint`      | ESLint (exige JSDoc en clases y funciones)      |
| `npm run typecheck` | `tsc --noEmit` con `checkJs` sobre todo el repo |
| `npm test`          | Tests (`node:test`) de todos los workspaces     |
| `npm run check`     | Los tres anteriores, en orden                   |

## Paquete `packages/shared`

| Módulo | Qué provee |
| :--- | :--- |
| `constantes.js` | Topics, grupos de consumidores, estados, motivos, prioridades, reglas de SLA |
| `eventos/esquemas.js` | Esquemas JSON por topic y `validarEvento` (Ajv) |
| `eventos/fabrica.js` | Factorías `crearEvento*` que validan antes de devolver el evento |
| `eventos/tipos.js` | Typedefs JSDoc de todos los eventos |
| `kafka/productor.js` | Productor Kafka con clave `shipmentId` |
| `kafka/consumidor.js` | Consumidor con commit manual + procesador puro: valida esquema, envía inválidos a la DLQ con motivo y continúa, descarta duplicados (idempotencia) y loguea `eventId`/partición/offset |
| `mongo/conexion.js` | Conexión a MongoDB con ping de verificación |
| `mongo/idempotencia.js` | Índices de `eventos_procesados` (único por consumidor+eventId, TTL 7 días) y `crearMarcadorIdempotencia` |
| `config.js` | Configuración por variables de entorno validada al arrancar (`KAFKA_BROKERS`, `MONGO_URI`, `MONGO_DB`, `LOG_NIVEL`) |
| `logger.js` | Logger JSON estructurado con loggers hijos por contexto |
| `apagado.js` | Apagado ordenado ante SIGTERM/SIGINT con pasos de limpieza |

## Servicio `simulador`

Genera eventos de origen en Kafka según la especificación. Requiere el entorno levantado (`npm run up`).

```bash
npm start -w services/simulador
```

Parámetros por variables de entorno (valores por defecto de la especificación):

| Variable | Default | Descripción |
| :--- | :--- | :--- |
| `SIM_ENVIOS_POR_MINUTO` | 20 | Envíos nuevos por minuto real |
| `SIM_FACTOR_ACELERACION` | 120 | 1 h simulada = 30 s reales; el tiempo simulado viaja en `ocurridoEn` |
| `SIM_SEMILLA` | 42 | Semilla del PRNG (mulberry32): misma semilla = misma corrida exacta |
| `SIM_ENVIOS_TOTAL` | 0 | 0 = flujo infinito; N = genera N envíos y deja de crear nuevos |
| `SIM_FALLO_NORTE / _CENTRO / _SUR` | 0.05 / 0.15 / 0.30 | Tasa de fallo por intento por zona |
| `SIM_MOTIVO_AUSENTE / _DIRECCION / _RECHAZADO / _ZONA` | 0.60 / 0.20 / 0.15 / 0.05 | Distribución de motivos de fallo |
| `SIM_DEMORA_HUB` | 0.10 | Probabilidad de demora en el hub |
| `SIM_DUPLICADO` | 0.02 | Probabilidad de mensaje duplicado |
| `SIM_FUERA_ORDEN` | 0.02 | Probabilidad de intercambio de eventos consecutivos |
| `SIM_MALFORMADO` | 0.01 | Probabilidad de mensaje malformado (para la DLQ) |

Un fallo por `AUSENTE` reintenta con nueva secuencia (hasta 3 intentos); otros motivos
o el tercer fallo terminan el ciclo del envío.

## Convenciones

- **Arquitectura:** Kafka es el único punto de contacto entre servicios; MongoDB
  guarda solo vistas derivadas; Next.js solo lee de MongoDB. Ver reglas
  permanentes en [`AGENTS.md`](AGENTS.md).
- **Identificadores de dominio en español** según la especificación
  (`shipmentId`, `ocurridoEn`, `secuencia`, etc.); comentarios y JSDoc en español.
- **JSDoc obligatorio** en toda clase, función, método y typedef; el lint falla si falta.
- **Commits:** Conventional Commits (`feat:`, `test:`, `chore:`, `docs:`, ...).
- **Configuración** por variables de entorno validadas al arrancar; sin números ni
  strings mágicos.
- Las decisiones técnicas se registran en [`docs/DECISIONES.md`](docs/DECISIONES.md).
