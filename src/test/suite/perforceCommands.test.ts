import { expect } from "chai";
import * as chai from "chai";
import * as chaiAsPromised from "chai-as-promised";
import * as sinonChai from "sinon-chai";

import * as vscode from "vscode";

import * as sinon from "sinon";
import { stubExecute } from "../helpers/StubPerforceModel";
import p4Commands from "../helpers/p4Commands";
import { PerforceCommands } from "../../PerforceCommands";
import { Utils } from "../../Utils";
import { PerforceContentProvider } from "../../ContentProvider";
import { Display } from "../../Display";
import { getLocalFile } from "../helpers/testUtils";

chai.use(sinonChai);
chai.use(p4Commands);
chai.use(chaiAsPromised);

describe("Perforce Command Module (integration)", () => {
    if (!vscode.workspace.workspaceFolders?.[0]) {
        throw new Error("No workspace folders open");
    }
    const workspaceUri = vscode.workspace.workspaceFolders[0].uri;
    let execCommand: sinon.SinonSpy<[string, ...any[]], Thenable<unknown>>;
    const subscriptions: vscode.Disposable[] = [];

    const doc = new PerforceContentProvider();

    before(async () => {
        await vscode.commands.executeCommand("workbench.action.closeAllEditors");
    });
    after(() => {
        doc.dispose();
    });

    beforeEach(() => {
        Display.initialize(subscriptions);
        stubExecute();
        execCommand = sinon.spy(vscode.commands, "executeCommand");
    });
    afterEach(() => {
        sinon.restore();
        subscriptions.forEach(sub => sub.dispose());
    });
    describe("Diff", () => {
        it("Opens the have revision for the currently open file by default", async () => {
            const localFile = getLocalFile(workspaceUri, "testFolder", "a.txt");
            await vscode.window.showTextDocument(localFile);
            await PerforceCommands.diff();
            expect(execCommand.lastCall).to.be.vscodeDiffCall(
                Utils.makePerforceDocUri(localFile, "print", "-q").with({
                    fragment: "have"
                }),
                localFile,
                "a.txt#have vs a.txt (workspace)"
            );
        });
        it("Opens the supplied revision for the currently open file", async () => {
            const localFile = getLocalFile(workspaceUri, "testFolder", "new.txt");
            await vscode.window.showTextDocument(localFile);
            await PerforceCommands.diff(5);
            expect(execCommand.lastCall).to.be.vscodeDiffCall(
                Utils.makePerforceDocUri(localFile, "print", "-q").with({
                    fragment: "5"
                }),
                localFile,
                "new.txt#5 vs new.txt (workspace)"
            );
        });
    });
});
