import type { NodeProxDatabase } from "./client.js";

type TransactionCallback<T> = Parameters<
  NodeProxDatabase["transaction"]
>[0] extends (transaction: infer TTransaction) => unknown
  ? (transaction: TTransaction) => Promise<T>
  : never;

export function withTransaction<T>(
  db: NodeProxDatabase,
  callback: TransactionCallback<T>,
): Promise<T> {
  return db.transaction(callback);
}
