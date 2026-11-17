/**
 * A service account kubeconfig for an API server nobody listens on (https://127.0.0.1:1): KubeDeck can
 * check and store it, and every call with it fails fast, so tests never reach a real cluster.
 */
// a self-signed certificate with no key anywhere: kubectl needs a parseable CA before it dials
const TEST_CA = "LS0tLS1CRUdJTiBDRVJUSUZJQ0FURS0tLS0tCk1JSUN0RENDQVp3Q0NRRDZ4R3BjZUpYaEV6QU5CZ2txaGtpRzl3MEJBUXNGQURBYk1Sa3dGd1lEVlFRRERCQnIKZFdKbFpHVmpheTEwWlhOMExXTmhNQ0FYRFRJMk1URXhOekEzTlRRMU1sb1lEekl4TWpZeE1ESTBNRGMxTkRVeQpXakFiTVJrd0Z3WURWUVFEREJCcmRXSmxaR1ZqYXkxMFpYTjBMV05oTUlJQklqQU5CZ2txaGtpRzl3MEJBUUVGCkFBT0NBUThBTUlJQkNnS0NBUUVBMDJQTURBV0Q0dHNiSjVVeGdYRDBNb21ZTGdVbGZLOFVUb1UrZUhjUEVqaHEKeDVxZFNHWmpyNDduZlRMUVV5ZVVpV1Vrbi8yS1VNQ2ZJOFRCRVR1WnhaVENZQStYRG5ZVllkVk9odjFSMTFxYgpmbGhiYm4yTTNRU1o5YktGVG1aazFpVmVFWmpkTGljWGRGOGJHZlc5d05kMmg2R1d4dHA5bTJNVEVPNVlWamIvCkovb1U0S0FMNlB0NW93bnloNnBhZTNOQUtUVkl1Q1E5aVkzSlhkaWh3anBrT0pwMm00elVpL3ZrcjA0SWdCTVQKNGc3QnNrTlN5bVFSMmQ0Y20yT0ZpRGM0NUhUWStHZTRkUEFxNEJDODhKUk1sVkpUMC8yWXZNL1MraTcyY3lZcgpNM2Z3a3ozRndUR0Z4cWYwMnJ0YzZhQWtKMkRXajB6cDhBRDVMaWxpNXdJREFRQUJNQTBHQ1NxR1NJYjNEUUVCCkN3VUFBNElCQVFBM1g3bnh1SU55b0tITnlhL3EvdmVERlJGWW9jclRZcHRIZkpBZ3hwc2tySXY3YVVBZjE5VjQKTFdIZ0J3a3R2SWpjY3lvNzQrRkdBNWpuSWV2OXZZNTJzQnY5ZHpncHNqaSt3QkdjUlhOWU9PT1Fnc3lyYWVmbwp1eUt0UjZvZHl0VFQ3ZWc2Zi9nOWR6RmQzZlFSMHI3NFpKZ2R6SDVtaE9JaTJmUDZQVTVVQ2VHZHA5c0F4eWt0CkFMOWhKUjhKQlN2SFhZVkh3RDVCSG41aWhYU01lNG9UTW1UUDF1dkMxUWpHK0xFWWRMb0pXWldkQ1NiMU5PalMKMWxvd0VWdW9tN1NoRC9ScTlJRW41OU90d3Y1b2oyVG1qMGdHU2xMRUFVWmhnTGtNWVhMMjZGNkwwcTlWaEpsbApCL3E3dEV2clhseGEzSWsxSFFBUnFvYTFob2g5TER5VQotLS0tLUVORCBDRVJUSUZJQ0FURS0tLS0tCg==";

export function unreachableKubeconfig(user: Record<string, unknown> = { token: "secret-token-123" }, cluster: Record<string, unknown> = {}): string {
  const extra = Object.entries(cluster).map(([k, v]) => `, ${k}: ${JSON.stringify(v)}`).join("");
  return `
apiVersion: v1
kind: Config
clusters: [{ name: c, cluster: { server: "https://127.0.0.1:1", certificate-authority-data: ${TEST_CA}${extra} } }]
users: [{ name: u, user: ${JSON.stringify(user)} }]
contexts: [{ name: x, context: { cluster: c, user: u, namespace: monitoring } }]
current-context: x
`;
}
