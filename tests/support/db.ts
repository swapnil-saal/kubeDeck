/** An empty KubeDeck database in memory, with every migration applied. */
import { migrate, openDatabase, type Database } from "@server/db";

export async function memoryDatabase(): Promise<Database> {
  const d = await openDatabase({ type: "sqlite", target: ":memory:" });
  await migrate(d);
  return d;
}
