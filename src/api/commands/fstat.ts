import * as vscode from "vscode";
import {
    flagMapper,
    makeSimpleCommand,
    splitIntoChunks,
    mergeAll,
    splitIntoSections
} from "../CommandUtils";
import { FstatInfo } from "../CommonTypes";
import { isTruthy } from "../../TsUtils";
import { splitIntoLines } from "../CommandUtils";

export interface FstatOptions {
    depotPaths: string[];
    chnum?: string;
    limitToShelved?: boolean;
    outputPendingRecord?: boolean;
}

function parseZTagField(field: string) {
    // examples:
    // ... depotFile //depot/testArea/stuff
    // ... mapped
    const matches = /[.]{3} (\w+)[ ]*(.+)?/.exec(field);
    if (matches) {
        return { [matches[1]]: matches[2] ? matches[2] : "true" } as Partial<FstatInfo>;
    }
}

function parseZTagBlock(block: string) {
    return splitIntoLines(block)
        .map(parseZTagField)
        .filter(isTruthy);
}

function parseFstatSection(file: string) {
    return mergeAll({ depotFile: "" }, ...parseZTagBlock(file)) as FstatInfo;
}

function parseFstatOutput(expectedFiles: string[], fstatOutput: string) {
    const all = splitIntoSections(fstatOutput.trim()).map(file =>
        parseFstatSection(file)
    );
    return expectedFiles.map(file => all.find(fs => fs["depotFile"] === file));
}

const fstatFlags = flagMapper<FstatOptions>(
    [
        ["e", "chnum"],
        ["Or", "outputPendingRecord"],
        ["Rs", "limitToShelved"]
    ],
    "depotPaths"
);

const fstatBasic = makeSimpleCommand("fstat", fstatFlags).ignoringStdErr;

export async function getFstatInfo(resource: vscode.Uri, options: FstatOptions) {
    const chunks = splitIntoChunks(options.depotPaths);
    const promises = chunks.map(paths =>
        fstatBasic(resource, { ...options, ...{ depotPaths: paths } })
    );

    const fstats = await Promise.all(promises);
    return fstats.flatMap((output, i) => parseFstatOutput(chunks[i], output));
}
