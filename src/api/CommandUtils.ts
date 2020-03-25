import { Utils } from "../Utils";
import { FileSpec, isFileSpec, PerforceFile, isUri } from "./CommonTypes";
import * as vscode from "vscode";
import * as PerforceUri from "../PerforceUri";
import { PerforceService } from "../PerforceService";
import { Display } from "../Display";

/**
 * Predicate used for filtering out undefined or null values from an array,
 * and resulting in an array of type T
 * @param obj a single element
 * @returns the truthiness of the value, and narrows the type to T
 */
export function isTruthy<T>(obj: T | undefined | null): obj is T {
    return !!obj;
}

/**
 * Extract a section of an array between two matching predicates
 * @param allLines The array to extract from
 * @param startingWith Matches the first line of the section (exclusive)
 * @param endingWith Matches the last line of the section - if not found, returns all elements after the start index
 */
export function extractSection<T>(
    allLines: T[],
    startingWith: (line: T) => boolean,
    endingWith: (line: T) => boolean
) {
    const startIndex = allLines.findIndex(startingWith);
    if (startIndex >= 0) {
        const endIndex = allLines.findIndex(endingWith);
        return allLines.slice(startIndex + 1, endIndex >= 0 ? endIndex : undefined);
    }
}

/**
 * Divides an array into sections that start with the matching line
 *
 * @param lines the array to divide
 * @param sectionMatcher a predicate that matches the first line of a section
 * @returns An array of string arrays. Each array is a section **starting** with the matching line.
 * If no matching line is present, the returned array is empty
 */
export function sectionArrayBy<T>(lines: T[], sectionMatcher: (line: T) => boolean) {
    const sections: T[][] = [];

    let nextMatch = lines.findIndex(sectionMatcher);
    let prevMatch = -1;
    while (nextMatch > prevMatch) {
        prevMatch = nextMatch;
        nextMatch = lines.slice(prevMatch + 1).findIndex(sectionMatcher) + prevMatch + 1;
        sections.push(
            lines.slice(prevMatch, nextMatch > prevMatch ? nextMatch : undefined)
        );
    }

    return sections;
}

function arraySplitter<T>(chunkSize: number) {
    return (arr: T[]): T[][] => {
        const ret: T[][] = [];
        for (let i = 0; i < arr.length; i += chunkSize) {
            ret.push(arr.slice(i, i + chunkSize));
        }
        return ret;
    };
}

export const splitIntoChunks = <T>(arr: T[]) => arraySplitter<T>(32)(arr);

export function applyToEach<T, R>(fn: (input: T) => R) {
    return (input: T[]) => input.map(i => fn(i));
}

export function concatIfOutputIsDefined<T, R>(...fns: ((arg: T) => R | undefined)[]) {
    return (arg: T) =>
        fns.reduce((all, fn) => {
            const val = fn(arg);
            return val !== undefined ? all.concat([val]) : all;
        }, [] as R[]);
}

export type CmdlineArgs = (string | undefined)[];

function makeFlag(flag: string, value: string | boolean | undefined): CmdlineArgs {
    if (typeof value === "string") {
        return value ? ["-" + flag, value] : [];
    }
    return value ? ["-" + flag] : [];
}

export function makeFlags(
    pairs: [string, string | boolean | undefined][],
    lastArgs?: (string | undefined)[]
): CmdlineArgs {
    return pairs.flatMap(pair => makeFlag(pair[0], pair[1])).concat(...(lastArgs ?? []));
}

type FlagValue = string | boolean | PerforceFile | PerforceFile[] | string[] | undefined;
type FlagDefinition<T> = {
    [key in keyof T]: FlagValue;
};

function lastArgAsStrings(
    lastArg: FlagValue,
    options?: FlagMapperOptions
): (string | undefined)[] | undefined {
    if (typeof lastArg === "boolean") {
        return undefined;
    }
    if (typeof lastArg === "string") {
        return [lastArg];
    }
    if (isFileSpec(lastArg)) {
        return [fileSpecToArg(lastArg, options?.ignoreRevisionFragments)];
    }
    if (options?.lastArgIsFormattedArray) {
        return lastArg as string[];
    }
    return pathsToArgs(lastArg, options);
}

type FlagMapperOptions = {
    lastArgIsFormattedArray?: boolean;
    ignoreRevisionFragments?: boolean;
};

/**
 * Create a function that maps an object of type P into an array of command arguments
 * @param flagNames A set of tuples - flag name to output (e.g. "c" produces "-c") and key from the object to use.
 * For example, given an object `{chnum: "1", delete: true}`, the parameter `[["c", "chnum"], ["d", "delete"]]` would map this object to `["-c", "1", "-d"]`
 * @param lastArg The field on the object that contains the final argument(s), that do not require a command line switch. Typically a list of paths to append to the end of the command. (must not be a boolean field)
 * @param lastArgIsFormattedArray If the last argument is a string array, disable putting quotes around the strings
 * @param fixedPrefix A fixed set of args to always put first in the perforce command
 */
export function flagMapper<P extends FlagDefinition<P>>(
    flagNames: [string, keyof P][],
    lastArg?: keyof P,
    fixedPrefix?: CmdlineArgs,
    options?: FlagMapperOptions
) {
    return (params: P): CmdlineArgs => {
        return (fixedPrefix ?? []).concat(
            makeFlags(
                flagNames.map(fn => {
                    return [fn[0], params[fn[1]] as string | boolean | undefined];
                }),
                lastArg
                    ? lastArgAsStrings(params[lastArg] as FlagValue, options)
                    : undefined
            )
        );
    };
}

const joinDefinedArgs = (args: CmdlineArgs) => args?.filter(isTruthy);

export function fragmentAsSuffix(
    fragment?: string,
    ignoreRevisionFragments?: boolean
): string {
    if (ignoreRevisionFragments) {
        return "";
    }
    return fragment ? (fragment.startsWith("@") ? fragment : "#" + fragment) : "";
}

function fileSpecToArg(fileSpec: FileSpec, ignoreRevisionFragments?: boolean) {
    if (isUri(fileSpec) && PerforceUri.isDepotUri(fileSpec)) {
        return (
            PerforceUri.getDepotPathFromDepotUri(fileSpec) +
            fragmentAsSuffix(fileSpec.fragment, ignoreRevisionFragments)
        );
    }
    return (
        Utils.expansePath(fileSpec.fsPath) +
        fragmentAsSuffix(fileSpec.fragment, ignoreRevisionFragments)
    );
}

export function pathsToArgs(arr?: (string | FileSpec)[], options?: FlagMapperOptions) {
    return (
        arr?.map(path => {
            if (isFileSpec(path)) {
                return fileSpecToArg(path, options?.ignoreRevisionFragments);
            } else if (path) {
                return path;
            }
        }) ?? []
    );
}

type CommandParams = {
    input?: string;
    hideStdErr?: boolean;
    stdErrIsOk?: boolean;
};

export function runPerforceCommandIgnoringStdErr(
    resource: vscode.Uri,
    command: string,
    args: string[],
    hideStdErr?: boolean
): Promise<string> {
    return runPerforceCommand(resource, command, args, {
        stdErrIsOk: true,
        hideStdErr: hideStdErr
    });
}

/**
 * Runs a perforce command, returning just the stdout.
 * By default, stderr throws an error and logs output.
 * Err always throws an error and logs output
 * @param resource determines the relevant perforce client, user details to use based on the workspace of the file
 * @param command the perforce command to run
 * @param args the arguments to provide to the perforce command
 * @param params adjust the behaviour of the command
 */
export async function runPerforceCommand(
    resource: vscode.Uri,
    command: string,
    args: string[],
    params: CommandParams
): Promise<string> {
    const { input, hideStdErr, stdErrIsOk } = params;

    try {
        const [stdout, stderr] = await runPerforceCommandRaw(
            resource,
            command,
            args,
            input
        );
        if (stderr) {
            if (hideStdErr) {
                Display.channel.appendLine(stderr.toString());
            } else {
                Display.showError(stderr.toString());
            }
            if (!stdErrIsOk) {
                throw stderr;
            }
        }
        return stdout;
    } catch (err) {
        Display.showError(err.toString());
        throw err;
    }
}

/**
 * Runs a perforce command, returning stdout and stderr in a tuple
 * Rejects on err, but does NOT show or log warnings in any case
 * @param resource determines the relevant perforce client, user details to use based on the workspace of the file
 * @param command the perforce command to run
 * @param args the arguments to provide to the perforce command
 */
function runPerforceCommandRaw(
    resource: vscode.Uri,
    command: string,
    args: string[],
    input?: string
): Promise<[string, string]> {
    return new Promise((resolve, reject) =>
        PerforceService.execute(
            resource,
            command,
            (err, stdout, stderr) => {
                if (err) {
                    reject(err);
                } else {
                    resolve([stdout, stderr]);
                }
            },
            args,
            input
        )
    );
}

/**
 * merge n objects of the same type, where the left hand value has precedence
 * @param args the objects to merge
 */
function mergeWithoutOverriding<T>(...args: T[]): T {
    return args.reduce((all, cur) => {
        return { ...cur, ...all };
    });
}

/**
 * merge n object of the same type, where the right hand value has precedence
 * @param args The objects to merge
 */
export function mergeAll<T>(...args: T[]): T {
    return args.reduce((all, cur) => {
        return { ...all, ...cur };
    });
}

/**
 * Returns a function that, when called with options of type T, runs a defined perforce command
 * @param command The name of the perforce command to run
 * @param fn A function that maps from the input options of type T to a set of arguments to pass into the command
 * @param otherParams An optional function that maps from the input options to the additional options to pass in to runCommand (not command line options!)
 */
export function makeSimpleCommand<T>(
    command: string,
    fn: (opts: T) => CmdlineArgs,
    otherParams?: (opts: T) => CommandParams
) {
    const func = (resource: vscode.Uri, options: T, overrideParams?: CommandParams) =>
        runPerforceCommand(
            resource,
            command,
            joinDefinedArgs(fn(options)),
            mergeWithoutOverriding(overrideParams ?? {}, otherParams?.(options) ?? {})
        );

    func.raw = (resource: vscode.Uri, options: T) =>
        runPerforceCommandRaw(resource, command, joinDefinedArgs(fn(options)));

    func.ignoringStdErr = (resource: vscode.Uri, options: T) =>
        runPerforceCommandIgnoringStdErr(resource, command, joinDefinedArgs(fn(options)));

    func.ignoringAndHidingStdErr = (resource: vscode.Uri, options: T) =>
        runPerforceCommandIgnoringStdErr(
            resource,
            command,
            joinDefinedArgs(fn(options)),
            true
        );

    return func;
}

/**
 * Create a function that awaits the result of the first async function, and passes it to the mapper function
 * @param fn The async function to await
 * @param mapper The function that accepts the result of the async function
 */
export function asyncOuputHandler<T extends any[], M, O>(
    fn: (...args: T) => Promise<M>,
    mapper: (arg: M) => O
) {
    return async (...args: T) => mapper(await fn(...args));
}
