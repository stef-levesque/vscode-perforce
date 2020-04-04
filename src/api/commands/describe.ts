import * as vscode from "vscode";
import {
    flagMapper,
    makeSimpleCommand,
    sectionArrayBy,
    splitIntoLines,
    asyncOuputHandler,
    removeIndent
} from "../CommandUtils";
import { FixedJob } from "../CommonTypes";
import { isTruthy, parseDate } from "../../TsUtils";

export interface DescribeOptions {
    chnums: string[];
    omitDiffs?: boolean;
    shelved?: boolean;
}

const describeFlags = flagMapper<DescribeOptions>(
    [
        ["S", "shelved"],
        ["s", "omitDiffs"]
    ],
    "chnums",
    [],
    { lastArgIsFormattedArray: true }
);

const describeCommand = makeSimpleCommand("describe", describeFlags);

export type DepotFileOperation = {
    depotPath: string;
    revision: string;
    operation: string;
};

export type DescribedChangelist = {
    chnum: string;
    user: string;
    client: string;
    date?: Date;
    isPending: boolean;
    description: string[];
    affectedFiles: DepotFileOperation[];
    shelvedFiles: DepotFileOperation[];
    fixedJobs: FixedJob[];
};

function withSection<T>(
    sections: string[][],
    sectionName: string,
    parser: (lines: string[]) => T | undefined
): T | undefined {
    const found = sections.find(s => s[0].startsWith(sectionName));
    if (!found) {
        return;
    }
    return parser(found);
}

function parseFileList(lines: string[]): DepotFileOperation[] {
    return lines
        .map(line => {
            const matches = /\.+\ (.*)#(.*) (.*)/.exec(line);
            if (matches) {
                const [, depotPath, revision, operation] = matches;
                return { depotPath, revision, operation };
            }
        })
        .filter(isTruthy);
}

function parseDescribeChangelist(lines: string[]): DescribedChangelist | undefined {
    const sections = sectionArrayBy(
        lines,
        line => line.endsWith("...") && !line.startsWith("\t")
    );

    const descStart = lines.slice(2);
    const descriptionEndPos = descStart.findIndex(line => !line.startsWith("\t"));
    const description = removeIndent(
        descStart.slice(0, descriptionEndPos >= 0 ? descriptionEndPos : undefined)
    );

    // example:
    // Change 35 by zogge@default on 2020/03/16 11:15:19 *pending*
    const chMatches = /^Change (\d+) by (\S+?)@(\S+) on (.*?)( \*pending\*)?$/.exec(
        lines[0]
    );

    if (chMatches) {
        const [, chnum, user, client, dateStr, pendingStr] = chMatches;

        const isPending = !!pendingStr;
        const affectedFiles =
            withSection(sections, "Affected files", parseFileList) ?? [];
        const shelvedFiles = withSection(sections, "Shelved files", parseFileList) ?? [];
        const fixedJobs =
            withSection(sections, "Jobs fixed", parseFixedJobsSection) ?? [];

        return {
            chnum,
            user,
            description,
            client,
            isPending,
            date: parseDate(dateStr),
            affectedFiles,
            shelvedFiles,
            fixedJobs
        };
    }
}

function parseDescribeOutput(output: string): DescribedChangelist[] {
    const allLines = splitIntoLines(output.trim());

    const changelists = sectionArrayBy(allLines, line => /^Change \d+ by/.test(line));

    return changelists.map(parseDescribeChangelist).filter(isTruthy);
}

export const describe = asyncOuputHandler(describeCommand, parseDescribeOutput);

export interface GetShelvedOptions {
    chnums: string[];
}

export type ShelvedChangeInfo = { chnum: number; paths: string[] };

function parseShelvedDescribeOuput(output: string): ShelvedChangeInfo[] {
    const allLines = splitIntoLines(output.trim());

    const changelists = sectionArrayBy(allLines, line => /^Change \d+ by/.test(line));

    return changelists
        .map(section => {
            const matches = section
                .slice(1)
                .map(line => /(\.+)\ (.*)#(.*) (.*)/.exec(line)?.[2])
                .filter(isTruthy);
            return { chnum: parseInt(section[0].split(" ")[1]), paths: matches };
        })
        .filter(isTruthy)
        .filter(c => c.paths.length > 0);
}

export async function getShelvedFiles(
    resource: vscode.Uri,
    options: GetShelvedOptions
): Promise<ShelvedChangeInfo[]> {
    if (options.chnums.length === 0) {
        return [];
    }
    const output = await describeCommand(resource, {
        chnums: options.chnums,
        omitDiffs: true,
        shelved: true
    });
    return parseShelvedDescribeOuput(output);
}

function parseFixedJobsSection(subLines: string[]): FixedJob[] {
    return sectionArrayBy(subLines, line => /^\w*? on/.test(line)).map(job => {
        return {
            id: job[0].split(" ")[0],
            description: job
                .slice(1)
                .filter(line => line.startsWith("\t"))
                .map(line => line.slice(1))
        };
    });
}

export interface GetFixedJobsOptions {
    chnum: string;
}

export async function getFixedJobs(resource: vscode.Uri, options: GetFixedJobsOptions) {
    const output = await describe(resource, {
        chnums: [options.chnum],
        omitDiffs: true
    });
    return output[0]?.fixedJobs;
}
