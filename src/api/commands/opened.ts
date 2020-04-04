import * as vscode from "vscode";
import { flagMapper, makeSimpleCommand, splitIntoLines } from "../CommandUtils";
import { PerforceFile } from "../CommonTypes";
import { isTruthy } from "../../TsUtils";

export type OpenedFileOptions = { chnum?: string; files?: PerforceFile[] };

export type OpenedFile = {
    depotPath: string;
    revision: string;
    chnum: string;
    operation: string;
    filetype: string;
    message: string;
};

export enum UnopenedFileReason {
    NOT_OPENED,
    NOT_IN_ROOT
}

export type UnopenedFile = {
    filePath: string;
    reason: UnopenedFileReason;
    message: string;
};

function parseOpenFile(line: string): OpenedFile | undefined {
    const matches = /(.+)#(\d+)\s-\s([\w\/]+)\s(default\schange|change\s\d+)\s\(([\w\+]+)\)/.exec(
        line
    );
    if (matches) {
        const [message, depotPath, revision, operation, chnumStr, filetype] = matches;
        const chnum = chnumStr.startsWith("change") ? chnumStr.split(" ")[1] : "default";
        return { depotPath, revision, operation, chnum, filetype, message };
    }
}

function parseOpenedOutput(output: string): OpenedFile[] {
    // example:
    // //depot/testArea/stuff#1 - edit change 46 (text)
    return splitIntoLines(output.trim())
        .map(parseOpenFile)
        .filter(isTruthy);
}

function parseUnopenFile(line: string): UnopenedFile | undefined {
    // example:
    // TestArea/newFile.txt - file(s) not opened on this client.
    // or
    // Path 'C:/Users/zogge\db.desc' is not under client's root 'c:\Users\zogge\Perforce\default'.
    const matches = /(?:((.+)\s-\sfile\(s\)\snot\sopened.*)|(Path\s'(.+)'\sis\snot\sunder.*))/.exec(
        line
    );

    if (matches) {
        const [, unopenMessage, unopenPath, noRootMessage, noRootPath] = matches;
        const message = unopenMessage || noRootMessage;
        const filePath = unopenMessage ? unopenPath : noRootPath;
        const reason = unopenMessage
            ? UnopenedFileReason.NOT_OPENED
            : UnopenedFileReason.NOT_IN_ROOT;
        return { message, filePath, reason };
    }
}

function parseOpenedErrors(output: string): UnopenedFile[] {
    return splitIntoLines(output.trim())
        .map(parseUnopenFile)
        .filter(isTruthy);
}

const openedFlags = flagMapper<OpenedFileOptions>([["c", "chnum"]], "files", [], {
    ignoreRevisionFragments: true
});

const opened = makeSimpleCommand("opened", openedFlags);

/**
 * Gets opened files, ignoring error messages about unopened or out of workspace files
 * @param resource the resource to determine where / how to run the command
 * @param options options for the command
 */
export async function getOpenedFiles(resource: vscode.Uri, options: OpenedFileOptions) {
    const output = await opened.ignoringAndHidingStdErr(resource, options);
    return parseOpenedOutput(output);
}

export type OpenedFileDetails = {
    open: OpenedFile[];
    unopen: UnopenedFile[];
};

/**
 * Gets opened files, and if files are specified in the options, the files that are not opened or are out of workspace from that list
 * @param resource the resource to determine where / how to run the command
 * @param options options for the command
 */
export async function getOpenedFileDetails(
    resource: vscode.Uri,
    options: OpenedFileOptions
): Promise<OpenedFileDetails> {
    const [stdout, stderr] = await opened.raw(resource, options);
    const open = parseOpenedOutput(stdout);
    const unopen = parseOpenedErrors(stderr);
    return { open, unopen };
}
