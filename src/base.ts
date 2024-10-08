import { encodeValue, decodeValue } from "./encoding";
import { SQL_STATEMENTS } from "./statements";
import type { IMiftahDB, MiftahValue, MiftahDBItem } from "./types";
import type { Database, Statement } from "better-sqlite3";
import { writeFileSync } from "node:fs";

export abstract class BaseMiftahDB<ExecuteReturnType = unknown[]>
  implements IMiftahDB
{
  protected declare db: Database;
  protected statements: Record<string, Statement>;

  constructor(path = ":memory:") {
    this.initializeDB(path);
    this.initDatabase();
    this.statements = this.prepareStatements();
  }

  protected abstract initializeDB(path: string | ":memory:"): void;

  protected prepareStatements(): Record<string, Statement> {
    return {
      get: this.db.prepare(SQL_STATEMENTS.GET),
      set: this.db.prepare(SQL_STATEMENTS.SET),
      exists: this.db.prepare(SQL_STATEMENTS.EXISTS),
      delete: this.db.prepare(SQL_STATEMENTS.DELETE),
      rename: this.db.prepare(SQL_STATEMENTS.RENAME),
      getExpire: this.db.prepare(SQL_STATEMENTS.GET_EXPIRE),
      setExpire: this.db.prepare(SQL_STATEMENTS.SET_EXPIRE),
      keys: this.db.prepare(SQL_STATEMENTS.KEYS),
      pagination: this.db.prepare(SQL_STATEMENTS.PAGINATION),
      cleanup: this.db.prepare(SQL_STATEMENTS.CLEANUP),
      countKeys: this.db.prepare(SQL_STATEMENTS.COUNT_KEYS),
      countExpired: this.db.prepare(SQL_STATEMENTS.COUNT_EXPIRED),
      vacuum: this.db.prepare(SQL_STATEMENTS.VACUUM),
      flush: this.db.prepare(SQL_STATEMENTS.FLUSH),
    };
  }

  protected initDatabase(): void {
    this.db.exec(SQL_STATEMENTS.CREATE_PRAGMA);
    this.db.exec(SQL_STATEMENTS.CREATE_TABLE);
    this.db.exec(SQL_STATEMENTS.CREATE_INDEX);
  }

  public get<T>(key: string): T | null {
    const result = this.statements.get.get(key) as MiftahDBItem | undefined;
    if (!result) return null;
    if (result?.expires_at && result.expires_at <= Date.now()) {
      this.delete(key);
      return null;
    }
    return decodeValue(result.value);
  }

  public set<T extends MiftahValue>(
    key: string,
    value: T,
    expiresAt?: Date
  ): void {
    const encodedValue = encodeValue(value);
    const expiresAtMs = expiresAt?.getTime() ?? null;
    this.statements.set.run(key, encodedValue, expiresAtMs);
  }

  public exists(key: string): boolean {
    const result = this.statements.exists.get(key) as { [key: string]: number };
    return Boolean(Object.values(result)[0]);
  }

  public delete(key: string): void {
    this.statements.delete.run(key);
  }

  public rename(oldKey: string, newKey: string): void {
    this.statements.rename.run(newKey, oldKey);
  }

  public setExpire(key: string, expiresAt: Date): void {
    const expiresAtMs = expiresAt.getTime();
    this.statements.setExpire.run(expiresAtMs, key);
  }

  public getExpire(key: string): Date | null {
    const result = this.statements.getExpire.get(key) as
      | {
          expires_at: number | null;
        }
      | undefined;
    return result?.expires_at ? new Date(result.expires_at) : null;
  }

  public keys(pattern = "%"): string[] {
    const result = this.statements.keys.all(pattern) as {
      key: string;
    }[];
    return result.map((r) => r.key);
  }

  public pagination(limit: number, page: number, pattern = "%"): string[] {
    const offset = (page - 1) * limit;
    const result = this.statements.pagination.all(pattern, limit, offset) as {
      key: string;
    }[];
    return result.map((r) => r.key);
  }

  public count(pattern = "%"): number {
    const result = this.statements.countKeys.get(pattern) as { count: number };
    return result.count;
  }

  public countExpired(pattern = "%"): number {
    const result = this.statements.countExpired.get(pattern) as {
      count: number;
    };
    return result.count;
  }

  public multiGet<T>(keys: string[]): Record<string, T | null> {
    const result: Record<string, T | null> = {};
    this.db.transaction(() => {
      for (const key of keys) {
        result[key] = this.get<T>(key);
      }
    })();
    return result;
  }

  public multiSet<T extends MiftahValue>(
    entries: Array<{ key: string; value: T; expiresAt?: Date }>
  ): void {
    this.db.transaction(() => {
      for (const entry of entries) {
        this.set(entry.key, entry.value, entry.expiresAt);
      }
    })();
  }

  public multiDelete(keys: string[]): void {
    this.db.transaction(() => {
      for (const key of keys) {
        this.delete(key);
      }
    })();
  }

  public vacuum(): void {
    this.statements.vacuum.run();
  }

  public close(): void {
    this.cleanup();
    this.db.close();
  }

  public cleanup(): void {
    this.statements.cleanup.run(Date.now());
  }

  public flush(): void {
    this.statements.flush.run();
  }

  public backup(path: string): void {
    const serialized = this.db.serialize();
    const arrayBuffer = serialized.buffer.slice(
      serialized.byteOffset,
      serialized.byteOffset + serialized.byteLength
    );
    writeFileSync(path, Buffer.from(arrayBuffer));
  }

  public abstract restore(path: string): void;

  public abstract execute(sql: string, params?: unknown[]): ExecuteReturnType;
}
