import type { GeneratedFile } from "../types.js"
import type { ResourceOpts } from "./index.js"

export function generate(opts: ResourceOpts): GeneratedFile[] {
  const { owner } = opts
  return [
    {
      path: "compose/kafka.yml",
      content: `services:
  infra-kafka:
    image: apache/kafka:latest
    ports:
      - "\${INFRA_KAFKA_PORT:-9092}:9092"
    environment:
      KAFKA_NODE_ID: 1
      KAFKA_PROCESS_ROLES: broker,controller
      KAFKA_LISTENERS: PLAINTEXT://0.0.0.0:9092,CONTROLLER://0.0.0.0:9093
      KAFKA_ADVERTISED_LISTENERS: PLAINTEXT://infra-kafka:9092
      KAFKA_CONTROLLER_LISTENER_NAMES: CONTROLLER
      KAFKA_LISTENER_SECURITY_PROTOCOL_MAP: CONTROLLER:PLAINTEXT,PLAINTEXT:PLAINTEXT
      KAFKA_CONTROLLER_QUORUM_VOTERS: 1@infra-kafka:9093
      KAFKA_OFFSETS_TOPIC_REPLICATION_FACTOR: 1
      CLUSTER_ID: dx-local-kafka-cluster-id-01
    healthcheck:
      test: ["CMD-SHELL", "/opt/kafka/bin/kafka-topics.sh --bootstrap-server localhost:9092 --list || exit 1"]
      interval: 10s
      timeout: 5s
      retries: 10
      start_period: 30s
    labels:
      dx.type: queue
      dx.owner: ${owner}
      dx.description: "Apache Kafka (KRaft)"
      dx.port.9092.name: kafka
      dx.port.9092.protocol: tcp
`,
    },
  ]
}
