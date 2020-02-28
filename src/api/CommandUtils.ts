import { Utils } from "../Utils";
import { FileSpec, isFileSpec, PerforceFile } from "./CommonTypes";
import * as vscode from "vscode";

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
    lastArgIsFormattedArray?: boolean
): (string | undefined)[] | undefined {
    if (typeof lastArg === "boolean") {
        return undefined;
    }
    if (typeof lastArg === "string") {
        return [lastArg];
    }
    if (isFileSpec(lastArg)) {
        return [
            Utils.expansePath(lastArg.fsPath) + (lastArg.suffix ? lastArg.suffix : "")
        ];
    }
    if (lastArgIsFormattedArray) {
        return lastArg as string[];
    }
    return pathsToArgs(lastArg);
}

/**
 * Create a function that maps an object of type P into an array of command arguments
 * @param flagNames A set of tuples - flag name to output (e.g. "c" produces "-c") and key from the object to use.
 * For example, given an object `{chnum: "1", delete: true}`, the parameter `[["c", "chnum"], ["d", "delete"]]` would map this object to `["-c", "1", "-d"]`
 * @param lastArg The field on the object that contains the final argument(s), that do not require a command line switch. Typically a list of paths to append to the end of the command. (must not be a boolean field)
 * @param lastArgIsFormattedArray If the last argument is a string array, disable putting quotes around the strings
 * @param fixedPrefix A fixed string to always put first in the perforce command
 */
export function flagMapper<P extends FlagDefinition<P>>(
    flagNames: [string, keyof P][],
    lastArg?: keyof P,
    lastArgIsFormattedArray?: boolean,
    fixedPrefix?: string
) {
    return (options: P): CmdlineArgs => {
        return [fixedPrefix].concat(
            makeFlags(
                flagNames.map(fn => {
                    return [fn[0], options[fn[1]] as string | boolean | undefined];
                }),
                lastArg
                    ? lastArgAsStrings(
                          options[lastArg] as FlagValue,
                          lastArgIsFormattedArray
                      )
                    : undefined
            )
        );
    };
}

const joinDefinedArgs = (args: CmdlineArgs) => args?.filter(isTruthy);

function pathsToArgs(arr?: (string | FileSpec)[]) {
    return (
        arr?.map(path => {
            if (isFileSpec(path)) {
                return Utils.expansePath(path.fsPath) + (path.suffix ? path.suffix : "");
            } else if (path) {
                return path;
            }
        }) ?? []
    );
}

export const fixedParams = (ps: Utils.CommandParams) => () => ps;

const runPerforceCommand = Utils.runCommand;

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
    otherParams?: (opts: T) => Exclude<Utils.CommandParams, { prefixArgs: string }>
) {
    return (resource: vscode.Uri, options: T) =>
        runPerforceCommand(
            resource,
            command,
            mergeWithoutOverriding(
                {
                    prefixArgs: joinDefinedArgs(fn(options))
                },
                otherParams?.(options) ?? {}
            )
        );
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
