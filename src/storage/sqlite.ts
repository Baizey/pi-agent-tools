import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

enum SqliteOpenMode {
    readonly = "readonly",
    readwrite = "readwrite",
}

enum DataBases {
    system = "system"
}

type SqliteOptions = {
    mode: SqliteOpenMode;
    file: string
};

function filePath(name: string) {
    return path.join(os.homedir(), ".pi", "agent", `${name}.sqlite`)
}

export class DatabaseOrm {
    readonly file: string;
    private readonly db: Database.Database;
    private readonly mode: SqliteOpenMode;

    static systemSql() {
        return new DatabaseOrm({
            mode: SqliteOpenMode.readwrite,
            file: filePath(DataBases.system)
        })
    }

    static systemReadOnly() {
        return new DatabaseOrm({
            mode: SqliteOpenMode.readonly,
            file: filePath(DataBases.system)
        })
    }

    private constructor(options: SqliteOptions) {
        this.file = options.file;
        this.mode = options.mode;

        if (!fs.existsSync(this.file)) {
            fs.mkdirSync(path.dirname(this.file), {recursive: true, mode: 0o700});
        }
        this.db = new Database(this.file, {
            readonly: this.mode === SqliteOpenMode.readonly,
        });

        this.db.pragma("busy_timeout = 5000");
        if (this.mode !== SqliteOpenMode.readonly) this.db.pragma("journal_mode = WAL");
    }

    exec(sql: string): void {
        this.db.exec(sql);
    }

    prepare(sql: string) {
        return this.db.prepare(sql);
    }

    transaction<T>(action: () => T): T {
        this.db.exec("begin immediate");
        try {
            const result = action();
            this.db.exec("commit");
            return result;
        } catch (error) {
            this.db.exec("rollback");
            throw error;
        }
    }

    close(): void {
        this.db.close();
    }
}
