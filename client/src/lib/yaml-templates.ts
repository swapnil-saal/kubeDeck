/** Starter manifests for "Create": small, valid, and easy to finish. The namespace comes from the scope. */
export interface YamlTemplate {
  id: string;
  label: string;
  yaml: string;
}

const T = (id: string, label: string, yaml: string): YamlTemplate => ({ id, label, yaml: yaml.replace(/^\n/, "") });

export const YAML_TEMPLATES: YamlTemplate[] = [
  T("deployment", "Deployment", `
apiVersion: apps/v1
kind: Deployment
metadata:
  name: my-app
  labels:
    app: my-app
spec:
  replicas: 1
  selector:
    matchLabels:
      app: my-app
  template:
    metadata:
      labels:
        app: my-app
    spec:
      containers:
        - name: app
          image: nginx:1.27
          ports:
            - containerPort: 80
          resources:
            requests:
              cpu: 50m
              memory: 64Mi
            limits:
              memory: 128Mi
`),
  T("service", "Service", `
apiVersion: v1
kind: Service
metadata:
  name: my-app
spec:
  selector:
    app: my-app
  ports:
    - port: 80
      targetPort: 80
`),
  T("configmap", "ConfigMap", `
apiVersion: v1
kind: ConfigMap
metadata:
  name: my-config
data:
  LOG_LEVEL: info
`),
  T("secret", "Secret", `
apiVersion: v1
kind: Secret
metadata:
  name: my-secret
type: Opaque
stringData:
  password: change-me
`),
  T("job", "Job", `
apiVersion: batch/v1
kind: Job
metadata:
  name: my-job
spec:
  backoffLimit: 2
  template:
    spec:
      restartPolicy: Never
      containers:
        - name: job
          image: busybox:1.36
          command: ["sh", "-c", "echo hello"]
`),
  T("cronjob", "CronJob", `
apiVersion: batch/v1
kind: CronJob
metadata:
  name: my-cronjob
spec:
  schedule: "0 * * * *"
  jobTemplate:
    spec:
      template:
        spec:
          restartPolicy: OnFailure
          containers:
            - name: job
              image: busybox:1.36
              command: ["sh", "-c", "date"]
`),
  T("ingress", "Ingress", `
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: my-app
spec:
  rules:
    - host: my-app.example.com
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: my-app
                port:
                  number: 80
`),
  T("pvc", "Volume claim", `
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: my-data
spec:
  accessModes: ["ReadWriteOnce"]
  resources:
    requests:
      storage: 1Gi
`),
  T("hpa", "Autoscaler", `
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: my-app
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: my-app
  minReplicas: 1
  maxReplicas: 5
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 70
`),
  T("namespace", "Namespace", `
apiVersion: v1
kind: Namespace
metadata:
  name: my-namespace
`),
  T("serviceaccount", "Service account", `
apiVersion: v1
kind: ServiceAccount
metadata:
  name: my-service-account
`),
  T("networkpolicy", "Network policy", `
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-same-namespace
spec:
  podSelector: {}
  policyTypes: ["Ingress"]
  ingress:
    - from:
        - podSelector: {}
`),
];

/** Which template fits a list: by sidebar key or kubectl type ("deployments", "pvc", "networkpolicies"…). */
const ALIASES: Record<string, string> = {
  deployments: "deployment", services: "service", configmaps: "configmap", secrets: "secret", jobs: "job",
  cronjobs: "cronjob", ingresses: "ingress", pvcs: "pvc", persistentvolumeclaims: "pvc", namespaces: "namespace",
  serviceaccounts: "serviceaccount", networkpolicies: "networkpolicy", horizontalpodautoscalers: "hpa",
};

export function templateFor(kindKey: string | undefined): YamlTemplate | undefined {
  if (!kindKey) return undefined;
  const id = ALIASES[kindKey] ?? kindKey;
  return YAML_TEMPLATES.find((t) => t.id === id);
}

/** A skeleton for any other kind, from its API discovery entry. */
export function skeletonFor(kind: string, apiVersion: string, namespaced: boolean): string {
  return `apiVersion: ${apiVersion}\nkind: ${kind}\nmetadata:\n  name: my-${kind.toLowerCase()}\n${namespaced ? "" : "# cluster-scoped: no namespace\n"}spec: {}\n`;
}
