/**
 * Projects (see shared/projects.ts), kept in KubeDeck's database on the desktop and in web mode.
 * This module owns the `project` table.
 */
export { registerProjectRoutes } from "./routes";
export { databaseProjectStore, memoryProjectStore, type ProjectStore, type StoredProject } from "./store";
