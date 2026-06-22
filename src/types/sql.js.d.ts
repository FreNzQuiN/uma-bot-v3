declare module 'qrcode-terminal' {
  export function generate(text: string, options?: { small?: boolean }): void;
}

// Partial declaration — covers only methods used by this project.
// Expand as needed when new sql.js APIs are used.
declare module 'sql.js' {
  interface Database {
    run(sql: string, params?: unknown[]): void;
    exec(sql: string, params?: unknown[]): QueryExecResult[];
    export(): Uint8Array;
    close(): void;
  }

  interface QueryExecResult {
    columns: string[];
    values: unknown[][];
  }

  interface SqlJsStatic {
    Database: new (data?: ArrayLike<number>) => Database;
  }

  export default function initSqlJs(config?: Record<string, unknown>): Promise<SqlJsStatic>;
  export { Database, SqlJsStatic, QueryExecResult };
}
