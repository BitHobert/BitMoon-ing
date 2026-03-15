import type { Collection, Db } from 'mongodb';

/** An immutable audit log entry */
interface AuditLogEntry {
    readonly action: string;
    readonly detail: Record<string, unknown>;
    readonly ip: string;
    readonly timestamp: number;
}

/**
 * AuditService logs every admin mutation to a MongoDB collection.
 * Entries are append-only — no updates, no deletes.
 */
export class AuditService {
    private static instance: AuditService;
    private logs!: Collection<AuditLogEntry>;

    private constructor() {}

    public static getInstance(): AuditService {
        if (!AuditService.instance) {
            AuditService.instance = new AuditService();
        }
        return AuditService.instance;
    }

    /** Attach to the existing Db instance (called once at startup). */
    public async connect(db: Db): Promise<void> {
        this.logs = db.collection<AuditLogEntry>('audit_logs');
        await this.logs.createIndex({ timestamp: -1 });
        await this.logs.createIndex({ action: 1 });
        console.log('[AuditService] Connected');
    }

    /**
     * Record an admin action.
     * Fire-and-forget — errors are logged but never propagated to the caller.
     */
    public log(action: string, detail: Record<string, unknown>, ip: string): void {
        const entry: AuditLogEntry = {
            action,
            detail,
            ip,
            timestamp: Date.now(),
        };

        this.logs.insertOne(entry).catch((err) => {
            console.error('[AuditService] Failed to write audit log:', err);
        });
    }

    /** Fetch recent audit entries (admin-only). */
    public async getRecent(limit = 50): Promise<AuditLogEntry[]> {
        return this.logs.find({}, { sort: { timestamp: -1 }, limit }).toArray();
    }
}
