#!/usr/bin/env bash
# scripts/topics.sh — Lista los topics de Kafka con su configuración relevante
# (particiones, retention.ms y cleanup.policy).
#
# Uso: scripts/topics.sh [nombre-del-topic]
#   Sin argumentos lista todos los topics; con argumento, solo ese.

set -euo pipefail

CONTENEDOR="${RUTASUR_KAFKA_CONTENEDOR:-rutasur-kafka}"
BOOTSTRAP="kafka:29092"
TOPIC="${1:-}"

if [[ -n "$TOPIC" ]]; then
  OPT_TOPICOS="--topic $TOPIC"
else
  OPT_TOPICOS=""
fi

echo "== Topics y configuración (broker: ${BOOTSTRAP}) =="
docker exec "$CONTENEDOR" \
  /opt/kafka/bin/kafka-topics.sh --bootstrap-server "$BOOTSTRAP" --describe $OPT_TOPICOS

echo
echo "== Configuración efectiva por topic =="
for t in ${TOPIC:-$(docker exec "$CONTENEDOR" /opt/kafka/bin/kafka-topics.sh --bootstrap-server "$BOOTSTRAP" --list)}; do
  echo "--- $t"
  docker exec "$CONTENEDOR" \
    /opt/kafka/bin/kafka-configs.sh --bootstrap-server "$BOOTSTRAP" \
    --entity-type topics --entity-name "$t" --describe |
    grep -E 'retention.ms|cleanup.policy|partitions' || true
done
