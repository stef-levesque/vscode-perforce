/**
 * Predicate used for filtering out undefined or null values from an array,
 * and resulting in an array of type T
 * @param obj a single element
 * @returns the truthiness of the value, and narrows the type to T
 */
export function isTruthy<T>(obj: T | undefined | null): obj is T {
    return !!obj;
}

export function parseDate(dateString: string) {
    // example: 2020/02/15 18:48:43
    // or: 2020/02/15
    const matches = /(\d{4})\/(\d{2})\/(\d{2})(?: (\d{2}):(\d{2}):(\d{2}))?/.exec(
        dateString.trim()
    );

    if (matches) {
        const [, year, month, day, hours, minutes, seconds] = matches;

        const hasTime = hours && minutes && seconds;

        return new Date(
            parseInt(year),
            parseInt(month) - 1,
            parseInt(day),
            hasTime ? parseInt(hours) : undefined,
            hasTime ? parseInt(minutes) : undefined,
            hasTime ? parseInt(seconds) : undefined
        );
    }
}
