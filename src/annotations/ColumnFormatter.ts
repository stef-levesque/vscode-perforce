import * as p4 from "../api/PerforceApi";

import { timeAgo } from "../DateFormatter";
import { Display } from "../Display";
import { isTruthy } from "../TsUtils";

const nbsp = "\xa0";

export type ColumnOption = {
    name: ValidColumn;
    length: number;
    padLeft: boolean;
    truncateRight: boolean;
    prefix?: string;
};

type ValidColumn = "revision" | "chnum" | "user" | "client" | "description" | "timeAgo";

export function parseColumns(columns: string[]) {
    return columns
        .map(parseColumn)
        .filter(isTruthy)
        .filter(col => col.length && col.length >= 0);
}

export function parseColumn(item: string): ColumnOption | undefined {
    //example:
    // truncate chnum to 4, keeping the rightmost chars, prefix with `change #`, align right
    // ->{change #}...chnum|4
    const columnRegex = /^(->)?(?:\{(.*?)\})?(\.{3})?(revision|chnum|user|client|description|timeAgo)\|(\d+)$/;
    const match = columnRegex.exec(item);
    if (match) {
        const [, padLeft, prefix, truncateRight, name, lenStr] = match;
        return {
            name: name as ValidColumn,
            length: parseInt(lenStr),
            padLeft: !!padLeft,
            truncateRight: !!truncateRight,
            prefix
        };
    } else {
        Display.showImportantError(
            item + " is not a valid column format. Skipping this column"
        );
    }
}

type ColumnBehavior = {
    value: (change: p4.FileLogItem, latestChange: p4.FileLogItem) => string;
};

type ColumnBehaviors = Record<ValidColumn, ColumnBehavior>;

const behaviors: ColumnBehaviors = {
    revision: {
        value: (change, latestChange) =>
            change.file === latestChange.file ? change.revision : "ᛦ" + change.revision
    },
    chnum: {
        value: change => change.chnum
    },
    user: { value: change => change.user },
    client: { value: change => change.client },
    description: {
        value: change => replaceWhitespace(change.description)
    },
    timeAgo: {
        value: change => (change.date ? timeAgo.format(change.date) : "Unknown")
    }
};

export function calculateTotalWidth(options: ColumnOption[]) {
    const totalWidth = options.reduce(
        (all, cur) =>
            // + 1 to include the space
            all + cur.length + (cur.prefix?.length ?? 0) + 1,
        -1
    ); // start on -1 to account for the extra space
    return Math.max(0, totalWidth);
}

function truncate(
    str: string,
    prefix: string,
    maxLength: number,
    truncateRight?: boolean
): string {
    if (str.length > maxLength) {
        return truncateRight
            ? prefix + "…" + str.slice(-(maxLength - 1))
            : prefix + str.slice(0, maxLength - 1) + "…";
    }
    return prefix + str;
}

function truncateOrPad(
    str: string,
    prefix: string,
    maxLength: number,
    padLeft?: boolean,
    truncateRight?: boolean
): string {
    const truncated = truncate(str, prefix, maxLength, truncateRight);
    const padSpaces = nbsp.repeat(
        Math.max(0, maxLength - (truncated.length - prefix.length))
    );
    return padLeft ? padSpaces + truncated : truncated + padSpaces;
}

function replaceWhitespace(str: string) {
    return str.replace(/\s/g, nbsp);
}

export function makeSummaryText(
    change: p4.FileLogItem,
    latestChange: p4.FileLogItem,
    columnOptions: ColumnOption[]
) {
    const formatted = columnOptions.reduceRight<string>((all, col) => {
        const fullValue = replaceWhitespace(
            behaviors[col.name].value(change, latestChange)
        );
        const availableWhitespace = /^([\s\xa0]*)/.exec(all);
        const wsLen = availableWhitespace?.[1] ? availableWhitespace[1].length : 0;
        const truncated = truncateOrPad(
            fullValue,
            col.prefix ?? "",
            col.length + wsLen,
            col.padLeft,
            col.truncateRight
        );
        return truncated + nbsp + all.slice(wsLen);
    }, "");
    return formatted;
}
