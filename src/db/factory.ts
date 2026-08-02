/**
 * Database factory — creates the appropriate adapter based on config.
 */

import type { IDatabase } from "./types";
import type { BotConfig } from "../types";
import { SqliteDatabase } from "./database";
import { log } from "../utils/logger";

export async function createDatabase(
  config: BotConfig["database"],
): Promise<IDatabase> {
  switch (config.backend) {
    case "mysql": {
      let MysqlDatabase: typeof import("./mysql-database").MysqlDatabase;
      try {
        ({ MysqlDatabase } = await import("./mysql-database"));
      } catch {
        throw new Error(
          "MySQL backend requires mysql2 package. Run: npm install mysql2",
        );
      }
      log.info(
        "Database",
        `Connecting to MySQL at ${config.mysql.host}:${config.mysql.port}/${config.mysql.database}`,
      );
      const db = new MysqlDatabase(config.mysql);
      await db.initialize();
      return db;
    }
    case "sqlite":
    default: {
      const db = new SqliteDatabase(
        config.sqlite.path,
        config.sqlite.autoSaveMs,
      );
      await db.initialize();
      return db;
    }
  }
}
