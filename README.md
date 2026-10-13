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

## Servicio `proyector` (CU1)

Consume `envios.estados` en el grupo `proyector` y mantiene la colección `envios`
(un documento por envío: estado actual, promesa, intentos, historial embebido y
última secuencia aplicada).

```bash
npm start -w services/proyector   # requiere npm run up
```

- Índices: `shipmentId` único, `estado+zonaId`, `promesa.venceEn`.
- Regla de orden: un evento con secuencia `<=` a la aplicada se descarta.
- Regla de duplicados: `eventId` ya registrado en `eventos_procesados` no se reaplica.
- Eventos inválidos van a `envios.estados.dlq` con su motivo y el consumo continúa.
- El offset se confirma solo después de escribir en MongoDB.

### Reconstrucción de la vista

```bash
node scripts/rebuild-envios.js
```

Borra `envios` y la repuebla leyendo el topic desde el inicio con un grupo nuevo
(`proyector-rebuild-*`), demostrando que la vista es derivada (NF: reconstrucción).

## Servicios `notificaciones` y `reprogramacion` (CU2)

Ambos consumen `envios.estados` en grupos independientes ante cada `ENTREGA_FALLIDA`:

```bash
npm start -w services/notificaciones    # grupo notificaciones
npm start -w services/reprogramacion    # grupo reprogramacion
```

- **Notificaciones** registra el aviso y publica **exactamente una** notificación por fallo
  en `notificaciones.enviadas` (idempotencia por `eventos_procesados`).
- **Reprogramación** publica en `envios.reprogramaciones` según las reglas puras
  (`src/reglas.js`):
  - `AUSENTE` → nuevo intento el **día hábil siguiente** en la **franja opuesta** (AM↔PM).
  - `DIRECCION_INCORRECTA` → `RETENIDO` hasta corrección (no se reprograma solo).
  - `RECHAZADO` → `DEVOLUCION` al comercio.
  - Tercer fallo (cualquier motivo) → `DEVOLUCION`.
  - `ZONA_INACCESIBLE` → `RETENIDO` (la spec no lo detalla; decisión documentada en DECISIONES).

El **proyector** además consume `envios.reprogramaciones` y `notificaciones.enviadas`:
las decisiones se agregan al historial, actualizan `intentos` y el estado derivado
(`RETENIDO`/`DEVOLUCION`), y las notificaciones se guardan en la colección
`notificaciones` (índice único por `eventId`).

## Servicio `analitica` (CU4)

Consume `envios.estados` y `envios.promesas` en el grupo `analitica` y actualiza
`metricas_diarias` **solo con incrementos atómicos** (`$inc` + upsert), con índice
único `fecha+zonaId+franja`.

```bash
npm start -w services/analitica
```

Indicadores alimentados:

| Indicador | Campos del documento | Dimensiones |
| :--- | :--- | :--- |
| Tasa de entrega en primer intento | `intentosPrimeros.total` / `.exitosos` | día, zona, franja |
| Distribución de motivos de fallo | `motivos.<MOTIVO>` | día, zona, franja |
| Cumplimiento de SLA | `sla.cumplidos` / `.incumplidos` y `porHub.<hubId>.sla.*` | día, zona, franja, hub |

Para evaluar el SLA guarda en la colección interna `promesas_envios` el vencimiento
de cada envío (ver DECISIONES). La idempotencia (`eventos_procesados`) garantiza que
un evento reprocesado no incrementa dos veces.

### Verificación manual de las métricas

```bash
node scripts/verificar-metricas.js   # exit 0 si coinciden todos los agregados
```

Recalcula los indicadores leyendo los topics desde el inicio con un grupo nuevo
(dos pasadas: primero promesas, luego estados, deduplicando por `eventId`) y los
compara contra `metricas_diarias`.

## Servicio `monitor-sla` (CU3)

```bash
SIM_FACTOR_ACELERACION=120 npm start -w services/monitor-sla
```

Consume `envios.promesas` y `envios.estados` en el grupo `monitor-sla` y mantiene una
tabla por envío (último estado + vencimiento) **en memoria con respaldo en MongoDB**
(`monitor_sla_estado`, restaurada al arrancar: no se pierden ni repiten alertas).

- **Reloj simulado:** el "ahora" es el máximo `ocurridoEn` recibido de los eventos;
  nunca el reloj de la máquina. Si el simulador se detiene, el tiempo simulado se
  congela (ver DECISIONES).
- **Barrido:** cada 1 minuto simulado = `60000 / SIM_FACTOR_ACELERACION` ms reales.
- **Reglas** (`src/reglas.js`, pura, con tests de borde):

  | Regla | Condición | Prioridad |
  | :--- | :--- | :--- |
  | SIN_INGRESO | Faltan < 10 h y no ingresó al hub | MEDIA |
  | SIN_SALIDA | Faltan < 4 h y no está en reparto | ALTA |
  | FALLO_DIA_LIMITE | `ENTREGA_FALLIDA` en el día del vencimiento | ALTA |
  | VENCIDO | Pasó el vencimiento sin `ENTREGADO` | CRITICA |

- Evalúa al recibir cada evento y en cada barrido de los envíos abiertos; una misma
  regla nunca alerta dos veces sobre el mismo envío, y `ENTREGADO` emite el cierre.
- Las alertas se publican en `alertas.sla` y el **proyector** las materializa en la
  colección `alertas` (índices `estado+prioridad`, `shipmentId`, y único por
  `shipmentId+regla`).

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

## API HTTP de control del simulador (panel de demo)

El simulador expone una API mínima para disparar escenarios durante la demo
(puerto `SIM_HTTP_PUERTO`, default **3010**). Es solo un canal de comando: los
servicios de negocio se comunican exclusivamente por Kafka (ver DECISIONES).

| Endpoint | Acción |
| :--- | :--- |
| `GET /salud` | Estado del servicio y hora simulada actual |
| `POST /escenarios/feliz` | Un envío recorre todo el ciclo sin incidentes |
| `POST /escenarios/ausente` | Falla por ausencia, se reprograma y entrega en el 2.º intento |
| `POST /escenarios/demorado` | Detenido en el hub con SLA ajustado (5 h): dispara alertas |
| `POST /escenarios/tercer-fallo` | Tres fallos por ausencia → devolución al comercio |
| `POST /escenarios/rafaga` | 500 envíos en pocos segundos (acumulación y recuperación) |
| `POST /eventos/malformado` | Inyecta un mensaje inválido en `envios.estados` (va a la DLQ) |

Ejemplos:

```bash
curl localhost:3010/salud
curl -X POST localhost:3010/escenarios/ausente
curl -X POST localhost:3010/eventos/malformado
```

Con `SIM_ENVIOS_POR_MINUTO=0` el flujo continuo queda desactivado y solo se
generan los escenarios disparados por API.

## Interfaz web (`apps/web`, Next.js)

Torre de control y detalle de envío, renderizadas en el servidor y actualizadas en
vivo por **Server-Sent Events** sobre los change streams de MongoDB. **Solo lee de
MongoDB**; jamás toca Kafka.

```bash
npm run up
npm run dev -w apps/web    # http://localhost:3000
```

| Ruta | Pantalla |
| :--- | :--- |
| `/` | Torre de control: contadores por estado, cola de alertas priorizada (Crítica > Alta > Media) y últimos envíos |
| `/envios/[shipmentId]` | Detalle: línea de tiempo, intentos, alertas y notificaciones (en vivo) |
| `GET /api/stream` | SSE con eventos `envio`, `alerta` y `notificacion` (change streams de esas colecciones) |

Estructura:

- `lib/mongo.js` — capa de acceso a datos (única que toca MongoDB).
- `app/api/stream/route.js` — route handler SSE con cierre limpio al desconectar.
- `app/components/TorreControl.jsx`, `DetalleEnvio.jsx` — componentes cliente que
  aplican los cambios SSE (EventSource reconecta solo).
- Estilos CSS a mano (`app/globals.css`); sin librerías de UI.

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
