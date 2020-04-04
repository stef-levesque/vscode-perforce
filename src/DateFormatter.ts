import TimeAgo from "javascript-time-ago";
import * as en from "javascript-time-ago/locale/en";
import * as vscode from "vscode";

TimeAgo.addLocale(en);

export const timeAgo = new TimeAgo("en-US");

export function toReadableDateTime(date?: Date) {
    if (!date) {
        return "???";
    }
    const dateOptions: Intl.DateTimeFormatOptions = {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
        hour: "numeric",
        minute: "numeric"
    };
    return date.toLocaleString(vscode.env.language, dateOptions);
}

export function toReadableDate(date?: Date) {
    if (!date) {
        return "???";
    }
    const dateOptions: Intl.DateTimeFormatOptions = {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric"
    };
    return date.toLocaleString(vscode.env.language, dateOptions);
}
