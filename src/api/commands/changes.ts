import { flagMapper, makeSimpleCommand, asyncOuputHandler } from "../CommandUtils";
import { ChangeInfo } from "../CommonTypes";
import { isTruthy } from "../../TsUtils";

export enum ChangelistStatus {
    PENDING = "pending",
    SHELVED = "shelved",
    SUBMITTED = "submitted"
}

export interface ChangesOptions {
    client?: string;
    status?: ChangelistStatus;
}

const changes = makeSimpleCommand(
    "changes",
    flagMapper<ChangesOptions>([
        ["c", "client"],
        ["s", "status"]
    ])
);

function parseChangelistDescription(value: string): ChangeInfo | undefined {
    // example:
    // Change 45 on 2020/02/15 by super@matto 'a new changelist with a much lo'

    // with -t flag
    // Change 45 on 2020/02/15 18:48:43 by super@matto 'a new changelist with a much lo'
    const matches = /Change\s(\d+)\son\s(.+)\sby\s(.+)@(.+?)\s(?:\*(.+)\*\s)?\'(.*)\'/.exec(
        value
    );

    if (matches) {
        const [, chnum, date, user, client, status, description] = matches;
        return { chnum, date, user, client, status, description };
    }
}

function parseChangesOutput(output: string): ChangeInfo[] {
    return output
        .split(/\r?\n/)
        .map(parseChangelistDescription)
        .filter(isTruthy);
}

export const getChangelists = asyncOuputHandler(changes, parseChangesOutput);
