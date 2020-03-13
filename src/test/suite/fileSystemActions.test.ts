/* eslint-disable @typescript-eslint/no-empty-function */
import { expect } from "chai";
import chai from "chai";
import chaiAsPromised from "chai-as-promised";
import sinonChai from "sinon-chai";

import * as vscode from "vscode";

import sinon from "sinon";
import p4Commands from "../helpers/p4Commands";
import { PerforceCommands } from "../../PerforceCommands";
import { WorkspaceConfigAccessor } from "../../ConfigService";

import { getLocalFile, getWorkspaceUri } from "../helpers/testUtils";
import FileSystemActions from "../../FileSystemActions";

chai.use(sinonChai);
chai.use(p4Commands);
chai.use(chaiAsPromised);

const basicFiles = {
    edit: ["testFolder", "a.txt"],
    subFolder: ["testFolder", "subFolder"],
    subFolderFile: ["testFolder", "subFolder", "subFile"],
    unknownFile: ["testFolder", "noexist"],
    unknownFile2: ["testFolder", "newfile"],
    excluded: ["testFolder", "excluded"]
};

const workspaceUri = getWorkspaceUri();

function getFile(file: keyof typeof basicFiles): vscode.Uri {
    return getLocalFile(workspaceUri, ...basicFiles[file]);
}

function stubEvent<T>() {
    type EventAttrs = {
        spy?: sinon.SinonSpy<[T], any>;
        fire?: (e: T) => any;
        registered: boolean;
    };
    const attrs: EventAttrs = {
        registered: false
    };

    const func = (
        listener: (e: T) => any,
        thisArg?: any,
        subscriptions?: vscode.Disposable[]
    ) => {
        attrs.registered = true;
        attrs.spy = sinon.spy(listener);
        attrs.fire = (e: T) => listener.call(thisArg, e);

        const disposable = { dispose: () => {} };
        subscriptions?.push(disposable);
        return disposable;
    };

    func.attrs = attrs;

    return func;
}

type WatcherConfig = {
    editOnFileSave?: boolean;
    editOnFileModified?: boolean;
    addOnFileCreate?: boolean;
    deleteOnFileDelete?: boolean;
};

function stubWatcherConfig(config: WorkspaceConfigAccessor, values: WatcherConfig) {
    sinon.stub(config, "editOnFileSave").get(() => !!values.editOnFileSave);
    sinon.stub(config, "editOnFileModified").get(() => !!values.editOnFileModified);
    sinon.stub(config, "addOnFileCreate").get(() => !!values.addOnFileCreate);
    sinon.stub(config, "deleteOnFileDelete").get(() => !!values.deleteOnFileDelete);
}

function makeStubEvents() {
    return {
        onDidChangeTextDocument: stubEvent<vscode.TextDocumentChangeEvent>(),
        onDidCreateFiles: stubEvent<vscode.FileCreateEvent>(),
        onWillDeleteFiles: stubEvent<vscode.FileWillDeleteEvent>(),
        onWillSaveTextDocument: stubEvent<vscode.TextDocumentWillSaveEvent>()
    };
}

describe("File System Actions", () => {
    let eventProvider: ReturnType<typeof makeStubEvents>;
    let workspaceConfig: WorkspaceConfigAccessor;
    let actions: FileSystemActions | undefined;
    let revertAndDelete: sinon.SinonStub<any>;
    let add: sinon.SinonStub<any>;
    const assignActions = () => {
        actions = new FileSystemActions(eventProvider, workspaceConfig);
    };
    beforeEach(() => {
        revertAndDelete = sinon.stub(PerforceCommands, "p4revertAndDelete").resolves();
        add = sinon.stub(PerforceCommands, "p4add").resolves();
        eventProvider = makeStubEvents();
        workspaceConfig = new WorkspaceConfigAccessor(workspaceUri);
    });
    afterEach(() => {
        FileSystemActions.disposeEvents();
        actions?.dispose();
        actions = undefined;
        sinon.restore();
    });
    describe("Delete on file delete", () => {
        const fireDeleteEvent = async (...files: vscode.Uri[]) => {
            const waitUntil = sinon.spy();

            eventProvider.onWillDeleteFiles.attrs.fire?.({
                files: files,
                waitUntil: waitUntil
            });

            expect(waitUntil).to.have.been.called;
            await waitUntil.lastCall.args[0];
        };

        it("Does not register for deletions when disabled", () => {
            stubWatcherConfig(workspaceConfig, {});
            assignActions();

            expect(eventProvider.onWillDeleteFiles.attrs.registered).to.be.false;
        });
        it("Does register for deletions when configured", () => {
            stubWatcherConfig(workspaceConfig, { deleteOnFileDelete: true });
            assignActions();

            expect(eventProvider.onWillDeleteFiles.attrs.registered).to.be.true;
        });
        it("Reverts and deletes files", async () => {
            stubWatcherConfig(workspaceConfig, { deleteOnFileDelete: true });
            assignActions();

            const file = getFile("edit");
            const file2 = getFile("subFolderFile");

            await fireDeleteEvent(file, file2);

            expect(revertAndDelete).to.have.been.calledWith(file);
            expect(revertAndDelete).to.have.been.calledWith(file2);
        });
        it("Reverts folders using a wildcard", async () => {
            stubWatcherConfig(workspaceConfig, { deleteOnFileDelete: true });
            assignActions();

            const folder = getFile("subFolder");

            await fireDeleteEvent(folder);

            const folderMatch = folder.with({ path: folder.path + "/..." });

            expect(revertAndDelete).to.have.been.calledWithMatch(folderMatch);
        });
        it("Ignores fstat errors", async () => {
            stubWatcherConfig(workspaceConfig, { deleteOnFileDelete: true });
            assignActions();

            const unknown = getFile("unknownFile");

            await fireDeleteEvent(unknown);

            expect(revertAndDelete).to.have.been.calledWithMatch(unknown);
        });
        it("Does not try to delete excluded files", async () => {
            stubWatcherConfig(workspaceConfig, { deleteOnFileDelete: true });
            assignActions();

            // files.exclude is specified in the workspace config as **/excluded
            const excluded = getFile("excluded");

            await fireDeleteEvent(excluded);

            expect(revertAndDelete).not.to.have.been.called;
        });
    });
    describe("Add on file create", () => {
        const fireAddEvent = (...files: vscode.Uri[]) => {
            eventProvider.onDidCreateFiles.attrs.fire?.({
                files: files
            });
        };

        it("Does not register for additions when disabled", () => {
            stubWatcherConfig(workspaceConfig, {});
            assignActions();

            expect(eventProvider.onWillDeleteFiles.attrs.registered).to.be.false;
        });
        it("Does register for additions when configured", () => {
            stubWatcherConfig(workspaceConfig, { addOnFileCreate: true });
            assignActions();

            expect(eventProvider.onDidCreateFiles.attrs.registered).to.be.true;
        });
        it("Adds new files", () => {
            stubWatcherConfig(workspaceConfig, { addOnFileCreate: true });
            assignActions();

            const file = getFile("unknownFile");
            const file2 = getFile("unknownFile2");

            fireAddEvent(file, file2);

            expect(add).to.have.been.calledWith(file);
            expect(add).to.have.been.calledWith(file2);
        });
    });
});
