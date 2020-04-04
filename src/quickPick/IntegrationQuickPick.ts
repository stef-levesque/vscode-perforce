import * as vscode from "vscode";

import * as PerforceUri from "../PerforceUri";
import * as p4 from "../api/PerforceApi";

import * as qp from "./QuickPickProvider";
import { showQuickPickForFile } from "./FileQuickPick";

export const integrationQuickPickProvider: qp.ActionableQuickPickProvider = {
    provideActions: async (uriOrStr: vscode.Uri | string) => {
        const uri = qp.asUri(uriOrStr);
        const actions = await makeIntegrationPicks(uri);
        return {
            items: actions,
            excludeFromHistory: true,
            placeHolder:
                "Choose integration for " +
                PerforceUri.getDepotPathFromDepotUri(uri) +
                "#" +
                uri.fragment
        };
    }
};

export async function showIntegPickForFile(uri: vscode.Uri) {
    await qp.showQuickPick("integ", uri);
}

function isInRevRange(rev: number, startRev: string | undefined, endRev: string) {
    if (!startRev) {
        return parseInt(endRev) === rev;
    }
    return parseInt(startRev) <= rev && parseInt(endRev) >= rev;
}

async function makeIntegrationPicks(uri: vscode.Uri) {
    const rev = parseInt(uri.fragment);

    const integs = await p4.integrated(uri, {
        file: uri,
        intoOnly: true,
        startingChnum: uri.fragment
    });

    return integs
        .filter(int => isInRevRange(rev, int.fromStartRev, int.fromEndRev))
        .map<qp.ActionableQuickPickItem>(int => {
            return {
                label: "$(git-merge) " + int.toFile + "#" + int.toRev,
                description:
                    int.operation +
                    " from #" +
                    qp.toRevString(int.fromStartRev, int.fromEndRev),
                performAction: () => {
                    const thisUri = PerforceUri.fromDepotPath(
                        PerforceUri.getUsableWorkspace(uri) ?? uri,
                        int.toFile,
                        int.toRev
                    );
                    showQuickPickForFile(thisUri);
                }
            };
        });
}
