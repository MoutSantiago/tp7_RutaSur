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
packages/shared         Utilidades compartidas (esquemas de eventos, constantes, lógica pura)
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
