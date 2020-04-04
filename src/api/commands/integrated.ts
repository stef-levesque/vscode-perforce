import {
    flagMapper,
    makeSimpleCommand,
    asyncOuputHandler,
    splitIntoLines
} from "../CommandUtils";
import { PerforceFile } from "../CommonTypes";
import { isTruthy } from "../../TsUtils";

export interface IntegratedOptions {
    intoOnly?: boolean;
    startingChnum?: string;
    file?: PerforceFile;
}

const integrateFlags = flagMapper<IntegratedOptions>(
    [
        ["s", "startingChnum"],
        ["-into-only", "intoOnly"]
    ],
    "file",
    undefined,
    { ignoreRevisionFragments: true }
);

const integratedCommand = makeSimpleCommand("integrated", integrateFlags)
    .ignoringAndHidingStdErr;

export type IntegratedRevision = {
    fromFile: string;
    fromStartRev?: string;
    fromEndRev: string;
    operation: string;
    toFile: string;
    toRev: string;
    displayDirection: string;
};

function parseIntegratedRevision(line: string): IntegratedRevision | undefined {
    // example:
    // //depot/branches/branch1/newFile.txt#4,#6 - edit into //depot/branches/branch2/newFile.txt#2
    // //depot/branches/branch1/newFile.txt#1 - branch from //depot/TestArea/newFile.txt#1,#2
    // //depot/branches/branch1/newFile.txt#9 - edit from //depot/TestArea/newFile.txt#3,#4
    // //depot/branches/branch1/newFile.txt#2,#9 - copy into //depot/TestArea/newFile.txt#5

    const matches = /^(.*?)#(\d+)(?:,#(\d+))? - (\S+) (into|from) (.*?)#(\d+)(?:,#(\d+))?$/.exec(
        line
    );

    if (matches) {
        const [
            ,
            leftFile,
            leftStartRev,
            leftEndRev,
            operation,
            direction,
            rightFile,
            rightStartRev,
            rightEndRev
        ] = matches;

        return direction === "from"
            ? {
                  fromFile: rightFile,
                  fromStartRev: rightEndRev ? rightStartRev : undefined,
                  fromEndRev: rightEndRev || rightStartRev,
                  operation,
                  toFile: leftFile,
                  toRev: leftStartRev,
                  displayDirection: direction
              }
            : {
                  fromFile: leftFile,
                  fromStartRev: leftEndRev ? leftStartRev : undefined,
                  fromEndRev: leftEndRev || leftStartRev,
                  operation,
                  toFile: rightFile,
                  toRev: rightStartRev,
                  displayDirection: direction
              };
    }
}

function parseIntegratedOutput(output: string) {
    return splitIntoLines(output)
        .map(parseIntegratedRevision)
        .filter(isTruthy);
}

export const integrated = asyncOuputHandler(integratedCommand, parseIntegratedOutput);
