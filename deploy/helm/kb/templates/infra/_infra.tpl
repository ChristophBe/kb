{{- /*
kb.infraServer renders one single-instance infrastructure server for
infra.enabled: a StatefulSet with a data volume and a Service.
  name, image, port (the Service's port name is the server name),
  container (extra container fields as YAML), volumes (extra pod volumes as YAML),
  dataPath (where the data volume is mounted).
*/ -}}
{{- define "kb.infraServer" -}}
{{- $root := .root -}}
{{- $p := $root.Values.infra.persistence -}}
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: {{ .name }}
  labels: {{- include "kb.labels" (dict "root" $root "component" .name) | nindent 4 }}
spec:
  serviceName: {{ .name }}
  replicas: 1
  selector:
    matchLabels: {{- include "kb.selectorLabels" (dict "root" $root "component" .name) | nindent 6 }}
  template:
    metadata:
      labels: {{- include "kb.labels" (dict "root" $root "component" .name) | nindent 8 }}
    spec:
      {{- with include "kb.podDefaults" $root | trim }}{{ . | nindent 6 }}{{ end }}
      containers:
        - name: {{ .name }}
          image: {{ .image }}
          ports:
            - name: {{ .name }}
              containerPort: {{ .port }}
          {{- .container | trim | nindent 10 }}
          volumeMounts:
            - name: data
              mountPath: {{ .dataPath }}
            {{- with .mounts }}{{ . | trim | nindent 12 }}{{ end }}
      {{- if or (not $p.enabled) .volumes }}
      volumes:
        {{- if not $p.enabled }}
        - name: data
          emptyDir: {}
        {{- end }}
        {{- with .volumes }}{{ . | trim | nindent 8 }}{{ end }}
      {{- end }}
  {{- if $p.enabled }}
  volumeClaimTemplates:
    - metadata:
        name: data
      spec:
        accessModes: [ReadWriteOnce]
        {{- with $p.storageClass }}
        storageClassName: {{ . }}
        {{- end }}
        resources:
          requests:
            storage: {{ $p.size }}
  {{- end }}
---
apiVersion: v1
kind: Service
metadata:
  name: {{ .name }}
  labels: {{- include "kb.labels" (dict "root" $root "component" .name) | nindent 4 }}
spec:
  selector: {{- include "kb.selectorLabels" (dict "root" $root "component" .name) | nindent 4 }}
  ports:
    - name: {{ .name }}
      port: {{ .port }}
      targetPort: {{ .name }}
{{- end -}}
