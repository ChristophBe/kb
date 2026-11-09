{{- /*
kb.component renders one module component (a service or worker from a
module.yaml): a Deployment and, when it serves gRPC, a Service. Pods carry
the prometheus.io/* annotations for annotation-based scraping of /metrics. The
generated templates/modules/<id>.yaml call it with the manifest's facts:
  name, module, language (go | python), port (0 for workers),
  metricsPort (Prometheus /metrics, every component), infra (list of postgres | nats | s3), peers (KB_<MODULE>_ADDR -> address).
Settings an operator changes come from .Values.components.<name>.

Services apply their own migrations at startup (goose / Alembic, one version
table per module), as in compose, so there is no migration Job; the startup
probe gives them time for it. Services report SERVING once their own
infrastructure is ready, never depending on peers.
*/ -}}
{{- define "kb.component" -}}
{{- $root := .root -}}
{{- $v := index $root.Values.components .name -}}
{{- if $v.enabled }}
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: {{ .name }}
  labels: {{- include "kb.labels" (dict "root" $root "component" .name "module" .module) | nindent 4 }}
spec:
  replicas: {{ $v.replicas }}
  selector:
    matchLabels: {{- include "kb.selectorLabels" (dict "root" $root "component" .name) | nindent 6 }}
  template:
    metadata:
      labels: {{- include "kb.labels" (dict "root" $root "component" .name "module" .module) | nindent 8 }}
      annotations:
        prometheus.io/scrape: "true"
        prometheus.io/port: {{ .metricsPort | quote }}
        prometheus.io/path: /metrics
    spec:
      {{- with include "kb.podDefaults" $root | trim }}{{ . | nindent 6 }}{{ end }}
      {{- if and $root.Values.infra.enabled .infra }}
      {{- /* The services exit when their infrastructure is unreachable; waiting
      here spares them the crash-loop back-off while the dev servers start. */}}
      initContainers:
        - name: wait-for-infra
          image: {{ $root.Values.infra.images.wait }}
          command:
            - sh
            - -c
            - {{ include "kb.waitForInfra" .infra | quote }}
          resources:
            requests: { cpu: 5m, memory: 8Mi }
            limits: { memory: 16Mi }
      {{- end }}
      containers:
        - name: {{ .name }}
          image: {{ include "kb.image" (dict "root" $root "repository" $v.image.repository) }}
          imagePullPolicy: {{ $root.Values.image.pullPolicy }}
          env:
            {{- if .port }}
            - name: KB_GRPC_PORT
              value: {{ .port | quote }}
            {{- end }}
            - name: KB_METRICS_PORT
              value: {{ .metricsPort | quote }}
            {{- range $key, $addr := .peers }}
            - name: {{ $key }}
              value: {{ $addr | quote }}
            {{- end }}
            {{- with $root.Values.otel.endpoint }}
            - name: KB_OTEL_ENDPOINT
              value: {{ . | quote }}
            {{- end }}
            {{- range .infra }}
            {{- include "kb.infraEnv" (dict "root" $root "kind" . "language" $.language) | trim | nindent 12 }}
            {{- end }}
            {{- range $key, $value := $v.env }}
            - name: {{ $key }}
              value: {{ $value | toString | quote }}
            {{- end }}
            {{- with $v.extraEnv }}
            {{- toYaml . | nindent 12 }}
            {{- end }}
          ports:
            {{- if .port }}
            - name: grpc
              containerPort: {{ .port }}
            {{- end }}
            - name: metrics
              containerPort: {{ .metricsPort }}
          {{- if .port }}
          # grpc.health.v1, as the compose healthchecks.
          startupProbe:
            grpc: { port: {{ .port }} }
            periodSeconds: 2
            failureThreshold: 150
          readinessProbe:
            grpc: { port: {{ .port }} }
            periodSeconds: 5
          livenessProbe:
            grpc: { port: {{ .port }} }
            periodSeconds: 10
            failureThreshold: 6
          {{- end }}
          {{- /* Workers have no health endpoint: Kubernetes restarts them when they exit. */}}
          resources: {{- toYaml $v.resources | nindent 12 }}
{{- if .port }}
---
apiVersion: v1
kind: Service
metadata:
  name: {{ .name }}
  labels: {{- include "kb.labels" (dict "root" $root "component" .name "module" .module) | nindent 4 }}
spec:
  selector: {{- include "kb.selectorLabels" (dict "root" $root "component" .name) | nindent 4 }}
  ports:
    - name: grpc
      port: {{ .port }}
      targetPort: grpc
      appProtocol: kubernetes.io/h2c
    - name: metrics
      port: {{ .metricsPort }}
      targetPort: metrics
{{- end }}
{{- end }}
{{- end -}}

{{- define "kb.waitForInfra" -}}
{{- $ports := dict "postgres" "5432" "nats" "4222" "s3" "8333" -}}
{{- range $i, $kind := . -}}
{{- if $i }} && {{ end }}until nc -z {{ $kind }} {{ index $ports $kind }}; do echo waiting for {{ $kind }}; sleep 2; done
{{- end -}}
{{- end -}}
