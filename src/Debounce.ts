class DebouncedCall<P extends any[], T> {
    private _expires: number;
    private _expired: boolean;
    private _promise?: Promise<T>;
    private _timer?: NodeJS.Timeout;
    res?: (val: T) => void;
    rej?: (err: any) => void;

    public constructor(
        private _func: (...rest: P) => T,
        now: number,
        private _time: number
    ) {
        this._expires = now + _time;
        this._expired = false;
    }

    public executeNow(...args: P): Promise<T> {
        this._timer = setTimeout(() => {
            this._expired = true;
        }, this._expires - Date.now());
        return Promise.resolve(this._func(...args));
    }

    public get canExecute() {
        return !this._expired;
    }

    public executeAfterDebounce(now: number, ...args: P): Promise<T> {
        this._expires = now + this._time;

        if (this._promise === undefined) {
            // a promise for the last execution
            this._promise = new Promise((res, rej) => {
                this.res = (val: T) => res(val);
                this.rej = (err: any) => rej(err);
            });
        }

        if (this._timer) {
            clearTimeout(this._timer);
        }
        // overrides args with the last call
        this._timer = setTimeout(() => {
            try {
                const ret = this._func(...args);
                this.res?.(ret);
            } catch (err) {
                this.rej?.(err);
            }
            this._expired = true;
        }, this._expires - Date.now());
        return this._promise;
    }

    public cancel() {
        if (this._timer && !this._expired) {
            clearTimeout(this._timer);
        }
        if (this._promise !== undefined && this.rej) {
            this.rej("Debounced function cancelled");
        }
    }
}

export type DebouncedFunction<P extends any[], T> = {
    (...args: P): Promise<T>;
    /**
     * Executes the function without attempting to perform a leading call.
     * Even if the function has not been recently called, it will still wait for the
     * timeout before running.
     * @param args the arguments to pass to the function
     */
    withoutLeadingCall(...args: P): Promise<T>;
    dispose(): void;
};

/**
 * Factory to create a debounced function that:
 * * Always executes on the leading edge,
 * * Executes on the trailing edge if it is called again during the debounce period.
 *
 * For the first invocation of the returned function, the underlying function is
 * called immediately and the result is returned in a resolved promise.
 *
 * For the next invocation, if `time` ms has not elapsed since the previous call,
 * a promise is returned that resolves after `time` ms with the result of the function.
 *
 * For subsequent invocations, the same promise is returned, and the promise is delayed
 * so that it resolves `time` ms after this call.
 *
 * If `time` ms has already elapsed since the last function call, the next invocation
 * behaves like the first function call again.
 *
 * The leading function is invoked with the parameters of the first call.
 * The trailing function is invoked with the parameters of the last call.
 *
 * The returned function is `disposable` (clears any waiting timeouts) and includes
 * a `withoutLeadingCall` function, that can be used to omit the leading call.
 *
 * @param func The function to debounce
 * @param time The time to wait before executing the trailing function
 * @returns The debounced function
 */
export function debounce<P extends any[], T>(
    func: (...rest: P) => T,
    time: number,
    onCall?: (...args: P) => void
): DebouncedFunction<P, T> {
    let lastDebounced: DebouncedCall<P, T> | undefined;

    const ret = (...args: P): Promise<T> => {
        const now = Date.now();

        onCall?.(...args);

        if (!lastDebounced || !lastDebounced.canExecute) {
            lastDebounced = new DebouncedCall(func, now, time);
            return lastDebounced.executeNow(...args);
        }

        return lastDebounced.executeAfterDebounce(now, ...args);
    };

    ret.withoutLeadingCall = (...args: P): Promise<T> => {
        const now = Date.now();

        onCall?.(...args);

        if (!lastDebounced || !lastDebounced.canExecute) {
            lastDebounced = new DebouncedCall(func, now, time);
        }

        return lastDebounced.executeAfterDebounce(now, ...args);
    };

    ret.dispose = () => {
        if (lastDebounced) {
            lastDebounced.cancel();
        }
        lastDebounced = undefined;
    };

    return ret;
}
