import { expect } from "chai";
import * as chai from "chai";
import chaiAsPromised from "chai-as-promised";
import sinonChai from "sinon-chai";

import * as vscode from "vscode";

import * as sinon from "sinon";
import { stubExecute, StubPerforceModel } from "../helpers/StubPerforceModel";
import p4Commands from "../helpers/p4Commands";
import { PerforceCommands } from "../../PerforceCommands";
import * as PerforceUri from "../../PerforceUri";
import { PerforceContentProvider } from "../../ContentProvider";
import { Display } from "../../Display";
import { getLocalFile } from "../helpers/testUtils";
import { PerforceSCMProvider } from "../../ScmProvider";
import { Status } from "../../scm/Status";

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

    let stubModel: StubPerforceModel;

    let refresh: sinon.SinonSpy;

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
        stubModel = new StubPerforceModel();
        execCommand = sinon.spy(vscode.commands, "executeCommand");
        refresh = sinon.stub(PerforceSCMProvider, "RefreshAll");
    });
    afterEach(async () => {
        await vscode.commands.executeCommand("workbench.action.files.revert");
        sinon.restore();
        subscriptions.forEach(sub => sub.dispose());
    });
    describe("Diff", () => {
        it("Opens the have revision for the currently open file by default", async () => {
            const localFile = getLocalFile(workspaceUri, "testFolder", "a.txt");
            stubModel.changelists = [
                {
                    chnum: "default",
                    description: "n/a",
                    files: [
                        {
                            depotPath: "//depot/testFolder/a.txt",
                            depotRevision: 2,
                            localFile: localFile,
                            operation: Status.EDIT
                        }
                    ]
                }
            ];
            await vscode.window.showTextDocument(localFile);
            await PerforceCommands.diff();
            expect(execCommand.lastCall).to.be.vscodeDiffCall(
                PerforceUri.fromDepotPath(localFile, "//depot/testFolder/a.txt", "2"),
                localFile,
                "a.txt#2 ⟷ a.txt (workspace)"
            );
        });
        it("Opens the supplied revision for the currently open file", async () => {
            const localFile = getLocalFile(workspaceUri, "testFolder", "new.txt");
            await vscode.window.showTextDocument(localFile);
            await PerforceCommands.diff(5);
            expect(execCommand.lastCall).to.be.vscodeDiffCall(
                PerforceUri.fromUri(localFile).with({
                    fragment: "5"
                }),
                localFile,
                "new.txt#5 ⟷ new.txt (workspace)"
            );
        });
    });
    describe("Revert", () => {
        it("Reverts the file open in the editor", async () => {
            const localFile = getLocalFile(workspaceUri, "testFolder", "a.txt");
            await vscode.window.showTextDocument(localFile, {
                preview: false
            });

            await PerforceCommands.revertOpenFile();

            // this is ugly but sinon is not matching the Uris in a single call
            expect(stubModel.revert).to.have.been.calledWithMatch({
                fsPath: localFile.fsPath
            });
            expect(stubModel.revert.getCall(-1).args[1]).to.deep.equal({
                paths: [localFile]
            });

            expect(refresh).to.have.been.called;
        });
    });
    describe("Delete", () => {
        it("Reverts and then deletes the file open in the editor", async () => {
            const localFile = getLocalFile(workspaceUri, "testFolder", "a.txt");
            await vscode.window.showTextDocument(localFile, {
                preview: false
            });

            await PerforceCommands.deleteOpenFile();

            expect(stubModel.revert).to.have.been.calledWithMatch({
                fsPath: localFile.fsPath
            });
            expect(stubModel.revert.getCall(-1).args[1]).to.deep.equal({
                paths: [localFile]
            });
            expect(stubModel.del).to.have.been.calledWithMatch({
                fsPath: localFile.fsPath
            });
            expect(stubModel.del.getCall(-1).args[1]).to.deep.equal({
                paths: [localFile]
            });

            expect(refresh).to.have.been.called;
        });
    });
    describe("Submit single", () => {
        it("Does not submit if the file has dirty changes", async () => {
            const warn = sinon.stub(Display, "showModalMessage");
            const localFile = getLocalFile(workspaceUri, "testFolder", "a.txt");
            const editor = await vscode.window.showTextDocument(localFile, {
                preview: false
            });
            await editor.edit(editBuilder =>
                editBuilder.insert(new vscode.Position(0, 0), "hello")
            );
            expect(vscode.window.activeTextEditor).to.equal(editor);
            expect(editor.document.isDirty).to.be.true;

            await PerforceCommands.submitSingle();
            expect(warn).to.have.been.calledWithMatch("unsaved");
            expect(stubModel.submitChangelist).not.to.have.been.called;
            await vscode.commands.executeCommand(
                "workbench.action.revertAndCloseActiveEditor"
            );
        });
        it("Does not submit files that have a different scheme", async () => {
            const showError = sinon.stub(Display, "showError");

            const localFile = getLocalFile(workspaceUri, "testFolder", "a.txt");
            await vscode.window.showTextDocument(
                PerforceUri.fromUri(localFile).with({
                    fragment: "5"
                })
            );

            await PerforceCommands.submitSingle();
            expect(showError).to.have.been.calledWithMatch("No open file");
        });
        it("Requests a description", async () => {
            const input = sinon.stub(vscode.window, "showInputBox").resolves(undefined);

            const localFile = getLocalFile(workspaceUri, "testFolder", "a.txt");
            await vscode.window.showTextDocument(localFile, {
                preview: false
            });

            await PerforceCommands.submitSingle();

            expect(input).to.have.been.called;
            expect(stubModel.submitChangelist).not.to.have.been.called;
        });
        it("Submits the file with the description", async () => {
            const input = sinon
                .stub(vscode.window, "showInputBox")
                .resolves("new changelist description");

            const localFile = getLocalFile(workspaceUri, "testFolder", "a.txt");
            await vscode.window.showTextDocument(localFile, {
                preview: false
            });

            await PerforceCommands.submitSingle();

            expect(input).to.have.been.called;
            expect(stubModel.submitChangelist).to.have.been.calledWithMatch(localFile, {
                file: { fsPath: localFile.fsPath },
                description: "new changelist description",
                chnum: undefined
            });
        });
    });
});
