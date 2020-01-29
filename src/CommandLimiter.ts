class QueueItem<T> {
    private _next?: QueueItem<T>;
    constructor(private _item: T) {}
    set next(next: QueueItem<T>) {
        this._next = next;
    }
    get next() {
        return this._next;
    }
    get item() {
        return this._item;
    }
}

export class Queue<T> {
    private _head?: QueueItem<T>;
    private _tail?: QueueItem<T>;
    private _length: number;

    public get length() {
        return this._length;
    }

    constructor() {
        this._length = 0;
    }

    public enqueue(item: T) {
        const qi = new QueueItem(item);
        if (this._tail) {
            this._tail.next = qi;
        } else {
            this._head = qi;
        }
        this._tail = qi;
        ++this._length;
    }

    public dequeue(): T | undefined {
        if (this._head) {
            const ret = this._head;
            this._head = this._head.next;
            if (!this._head) {
                this._tail = undefined;
            }
            --this._length;
            return ret.item;
        }
    }
}

interface QueuedCommand {
    id: string;
    command: (callback: LimiterCallback) => any;
    callback: LimiterCallback;
}

type LimiterCallback = () => void;

export class CommandLimiter {
    private _queue: Queue<QueuedCommand>;
    private _running: Map<string, QueuedCommand>;
    private _inDebugMode: boolean;

    constructor(private _maxConcurrent: number) {
        this._queue = new Queue<QueuedCommand>();
        this._running = new Map<string, QueuedCommand>();
        this._inDebugMode = false;
    }

    get queueLength() {
        return this._queue.length;
    }

    get runningCount() {
        return this._running.size;
    }

    set debugMode(on: boolean) {
        this._inDebugMode = on;
    }

    private get logPrefix() {
        return (
            "Command Limiter: R: " + this.runningCount + " Q: " + this.queueLength + " : "
        );
    }

    /**
     * Submit a job to be executed
     * @param command the command to run when the job is dequeued. The command MUST call the callback to indicate that it has completed.
     * @param id an identifier for the job. MUST BE UNIQUE (TODO validate uniqueness)
     * @returns a promise that resolves once the job has called the callback, or rejects if the job throws an error (regardless of whether it called the callback)
     */
    public submit(
        command: (callback: LimiterCallback) => any,
        id: string
    ): Promise<void> {
        let item: QueuedCommand;
        const promise = new Promise<void>((res, rej) => {
            const doneCallback = () => {
                this.completed(id);
                res();
            };
            item = {
                id,
                command: () => {
                    try {
                        command(doneCallback);
                    } catch (err) {
                        this.completed(id);
                        rej(err);
                    }
                },
                callback: doneCallback
            };

            if (this._maxConcurrent > 0 && this._running.size >= this._maxConcurrent) {
                if (this._inDebugMode) {
                    console.log(this.logPrefix + " ENQUEUE " + item.id);
                }
                this._queue.enqueue(item);
            } else {
                this.execute(item);
            }
        });

        return promise;
    }

    private completed(id: string) {
        if (this._inDebugMode) {
            console.log(this.logPrefix + " COMPLETED " + id);
        }
        if (this._running.has(id)) {
            this._running.delete(id);
            this.executeNext();
        }
    }

    private execute(item: QueuedCommand) {
        if (this._inDebugMode) {
            console.log(this.logPrefix + " EXECUTING " + item.id);
        }
        this._running.set(item.id, item);
        setImmediate(() => item.command(item.callback));
    }

    private executeNext() {
        if (this._maxConcurrent <= 0 || this._running.size < this._maxConcurrent) {
            const item = this._queue.dequeue();
            if (item) {
                this.execute(item);
            }
        }
    }
}
