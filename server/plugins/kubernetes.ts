/** The assistant's Kubernetes tools: always on, nothing to configure; listed so the catalog is complete. */
import { definePlugin } from "./manager";

definePlugin({
  id: "kubernetes",
  name: "Kubernetes tools",
  description: "Lets the assistant list, describe and read logs of resources, and run kubectl after you approve. Always acts as the signed-in person.",
  category: "core",
  kind: "builtin",
  fields: [],
  alwaysOn: true,
  provides: { tools: ["k8s_list", "k8s_describe", "k8s_logs", "kubectl", "bash", "monitor_logs", "ask_human", "present_dashboard"] },
  start: () => ({}),
});
