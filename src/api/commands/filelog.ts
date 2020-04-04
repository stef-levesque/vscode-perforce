import * as vscode from "vscode";
import {
    flagMapper,
    makeSimpleCommand,
    sectionArrayBy,
    splitIntoLines
} from "../CommandUtils";
import { PerforceFile } from "../CommonTypes";
import { isTruthy, parseDate } from "../../TsUtils";

export interface FilelogOptions {
    file: PerforceFile;
    followBranches?: boolean;
}

const filelogFlags = flagMapper<FilelogOptions>([["i", "followBranches"]], "file", [
    "-l",
    "-t"
]);

const filelog = makeSimpleCommand("filelog", filelogFlags);

export enum Direction {
    TO,
    FROM
}

export type FileLogIntegration = {
    file: string;
    startRev?: string;
    endRev: string;
    operation: string;
    direction: Direction;
};

export type FileLogItem = {
    file: string;
    description: string;
    revision: string;
    chnum: string;
    operation: string;
    date?: Date;
    user: string;
    client: string;
    integrations: FileLogIntegration[];
};

function parseFileLogIntegrations(lines: string[]): FileLogIntegration[] {
    return lines
        .map(line => {
            const matches = /^.{3} .{3} (\S+) (into|from) (.*?)#(\d+)(?:,#(\d+))?$/.exec(
                line
            );
            if (matches) {
                const [, operation, dirString, file, startRevStr, endRevStr] = matches;
                const direction = dirString === "into" ? Direction.TO : Direction.FROM;
                const startRev = endRevStr ? startRevStr : undefined;
                const endRev = endRevStr ? endRevStr : startRevStr;
                return { operation, direction, file, startRev, endRev };
            }
        })
        .filter(isTruthy);
}

function parseFilelogItem(item: string[], file: string): FileLogItem | undefined {
    // example:
    // ... #9 change 43 integrate on 2020/03/29 18:48:43 by zogge@default (text)
    //
    //    integrate from main
    //
    // ... ... copy into //depot/TestArea/newFile.txt#5
    // ... ... edit from //depot/TestArea/newFile.txt#3,#4
    const [header, ...desc] = item;

    const matches = /^\.{3} #(\d+) change (\d+) (\S+) on (.*?) by (.*?)@(.*?) (.*?)$/.exec(
        header
    );
    if (matches) {
        const [, revision, chnum, operation, date, user, client] = matches;
        const description = desc
            .filter(l => l.startsWith("\t"))
            .map(l => l.slice(1))
            .join("\n");
        const integStrings = desc.filter(l => l.startsWith("... ..."));
        const integrations = parseFileLogIntegrations(integStrings);

        return {
            file,
            description,
            revision,
            chnum,
            operation,
            date: parseDate(date),
            user,
            client,
            integrations
        };
    }
}

function parseFileLogFile(lines: string[]) {
    const histories = sectionArrayBy(lines.slice(1), line => line.startsWith("... #"));

    const file = lines[0];

    return histories.map(h => parseFilelogItem(h, file)).filter(isTruthy);
}

function parseFileLogFiles(lines: string[]) {
    const files = sectionArrayBy(lines, line => line.startsWith("//"));

    return files.flatMap(parseFileLogFile);
}

function parseFilelogOutput(output: string) {
    const lines = splitIntoLines(output);

    return parseFileLogFiles(lines);
}

export async function getFileHistory(resource: vscode.Uri, options: FilelogOptions) {
    const output = await filelog(resource, options);
    return parseFilelogOutput(output);
}
